import { cssr, styles as sharedStyles } from 'dsh-tauri-ui/client'

const { c, bem: { b, e } } = cssr
const { borderL2, layer1, layer3, primary, secondary, tertiary } = sharedStyles

export default b('ui-components', {
  display: 'flex',
  flexDirection: 'column',
  gap: '22px',
  width: '100%',
  minWidth: 0,
  color: primary,
}, [
  e('section', {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
  }),
  e('title', {
    fontSize: '13px',
    fontWeight: '600',
    lineHeight: '20px',
    color: primary,
  }),
  e('hint', {
    fontSize: '12px',
    lineHeight: '1.5',
    color: tertiary,
  }),
  e('row', {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  }),
  e('grid', {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '10px',
  }),
  e('card', {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
    padding: '12px',
    border: `0.5px solid ${borderL2}`,
    borderRadius: '10px',
    background: layer1,
  }),
  e('cardHead', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  }),
  e('name', {
    fontSize: '12px',
    fontWeight: '600',
    lineHeight: '18px',
    color: primary,
  }),
  e('badge', {
    flex: 'none',
    padding: '0 6px',
    fontSize: '10px',
    lineHeight: '16px',
    color: secondary,
    background: layer3,
    borderRadius: '999px',
  }),
  e('meta', {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    fontSize: '11px',
    lineHeight: '16px',
    color: tertiary,
  }),
  e('code', {
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '16px',
    color: secondary,
    wordBreak: 'break-all',
  }),
  e('sample', {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    minHeight: '48px',
    padding: '10px',
    background: layer3,
    borderRadius: '8px',
  }),
  e('stack', {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '8px',
  }),
  c('.dshp-ui-components__sample > *', { flex: 'none' }),
])
