# -*- coding: utf-8 -*-
"""`dbx_query` 摘要化（「在源头收敛上下文」）的离线测试。

不连库：用假游标喂结果集，验证「小结果内联 / 大结果只回 head + 完整结果落盘 / 落盘失败
只降级不报错」这几条契约——它们是这条改动的全部价值所在。
"""
from __future__ import annotations

import json

import pytest

import dbx_mcp_server as srv


class FakeCursor:
    """按 fetchmany 分批吐结果的假游标（模拟 sqlite3 / pymysql 的 DB-API 形态）。"""

    def __init__(self, columns: list[str], rows: list[tuple], batch: int = 0):
        self.description = [(name,) for name in columns]
        self._rows = list(rows)
        self._batch = batch
        self._offset = 0
        self.closed = False
        self.executed: list[str] = []

    def execute(self, sql: str, params: object = ()) -> None:
        self.executed.append(sql)

    def fetchmany(self, size: int) -> list[tuple]:
        step = self._batch or size
        chunk = self._rows[self._offset:self._offset + step]
        self._offset += len(chunk)
        return chunk

    def fetchall(self) -> list[tuple]:
        chunk = self._rows[self._offset:]
        self._offset = len(self._rows)
        return chunk

    def close(self) -> None:
        self.closed = True


class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor

    def cursor(self) -> FakeCursor:
        return self._cursor


def rows_of(count: int) -> list[tuple]:
    return [(i, f"name-{i}") for i in range(count)]


@pytest.fixture()
def wired(tmp_path, monkeypatch):
    """把连接换成假游标，并把落盘目录指到 tmp_path（别写进真实数据目录）。"""
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "dsh"))
    monkeypatch.delenv("BOBO_ROOT", raising=False)

    def wire(rows, columns=("id", "name"), batch=0):
        cursor = FakeCursor(list(columns), rows, batch=batch)
        monkeypatch.setattr(srv, "_get_conn", lambda name: FakeConn(cursor))
        return cursor

    return wire


class TestDbxQueryDigest:
    def test_small_result_is_returned_inline_not_spilled(self, wired):
        cursor = wired(rows_of(3))
        result = srv.dbx_query("demo", "select id, name from t")
        assert result["ok"] is True
        assert result["rows"] == [{"id": 0, "name": "name-0"}, {"id": 1, "name": "name-1"},
                                  {"id": 2, "name": "name-2"}]
        assert "head" not in result
        assert result["row_count"] == 3 and result["returned"] == 3
        assert result["truncated"] is False
        assert result["written"] == {}
        assert "结果完整" in "".join(result["notes"])
        assert cursor.closed is True

    def test_columns_come_from_the_cursor_description(self, wired):
        wired(rows_of(1), columns=("a", "b"))
        assert srv.dbx_query("demo", "select * from t")["columns"] == ["a", "b"]

    def test_large_result_returns_head_and_spills_the_full_set(self, wired):
        wired(rows_of(500), batch=7)
        result = srv.dbx_query("demo", "select id, name from t", max_rows=5)
        assert result["truncated"] is True
        assert len(result["head"]) == 5
        assert "rows" not in result
        assert result["row_count"] == 500 and result["returned"] == 5
        path = result["written"]["jsonl"]
        lines = [json.loads(line) for line in open(path, encoding="utf-8").read().splitlines()]
        # 落盘的必须是**完整结果集**（含内联的 head），否则「读文件」拿不到全部
        assert len(lines) == 500
        assert lines[0] == {"id": 0, "name": "name-0"}
        assert lines[-1] == {"id": 499, "name": "name-499"}
        assert path in result["next"]
        assert "别为了翻页反复重跑" in "".join(result["notes"])

    def test_save_false_keeps_the_digest_but_writes_nothing(self, wired, tmp_path):
        wired(rows_of(50))
        result = srv.dbx_query("demo", "select id, name from t", max_rows=5, save=False)
        assert result["truncated"] is True
        assert result["written"] == {}
        assert not list((tmp_path / "dsh").rglob("*.jsonl"))
        assert "未落盘" in "".join(result["notes"])

    def test_a_write_failure_degrades_instead_of_failing_the_query(self, wired, tmp_path, monkeypatch):
        import result_digest
        blocker = tmp_path / "blocked"
        blocker.write_text("x", encoding="utf-8")
        monkeypatch.setattr(result_digest, "result_dir", lambda: blocker / "tool-results")
        wired(rows_of(50))
        result = srv.dbx_query("demo", "select id, name from t", max_rows=5)
        assert result["ok"] is True
        assert result["written"] == {}
        assert result["row_count"] == 50
        assert "落盘失败" in "".join(result["notes"])

    def test_hitting_the_hard_ceiling_is_reported(self, wired, monkeypatch):
        monkeypatch.setattr(srv, "HARD_FETCH_CEILING", 10)
        wired(rows_of(50))
        result = srv.dbx_query("demo", "select id, name from t", max_rows=10)
        assert result["row_count"] == 10
        assert "硬上限" in "".join(result["notes"])

    def test_detail_full_keeps_the_old_plain_list_and_ignores_max_rows(self, wired):
        wired(rows_of(300))
        result = srv.dbx_query("demo", "select id, name from t", detail="full", max_rows=5)
        assert isinstance(result, list)
        assert len(result) == 300
        assert result[0] == {"id": 0, "name": "name-0"}

    def test_empty_result_is_a_valid_conclusion(self, wired):
        wired([])
        result = srv.dbx_query("demo", "select id, name from t where 1=0")
        assert result["row_count"] == 0 and result["truncated"] is False
        assert result["rows"] == []

    def test_statement_without_a_result_set_does_not_raise(self, wired):
        # 没有 result set 的语句（描述为空）也要给出结论而不是抛异常
        wired([(1, 2)], columns=[])
        result = srv.dbx_query("demo", "select 1")
        assert result["ok"] is True
        assert result["columns"] == [] and result["row_count"] == 0

    def test_non_select_is_still_refused(self):
        # 只读闸门是安全边界，本次改动一个字都不许碰
        with pytest.raises(ValueError, match="仅允许只读 SELECT"):
            srv.dbx_query("demo", "delete from t")
