# -*- coding: utf-8 -*-
"""让 tests/ 下的用例能直接 import scripts/ 里的实现模块（与 MCP server 的运行方式一致）。"""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
