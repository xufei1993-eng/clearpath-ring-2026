// Ordering is based on the current media session, never a claim about capture
// time in an uploaded still photograph (that time is user-provided/unknown).
export function isLaterFrame(anchor,current) {
  if(!anchor || !current || anchor.source!==current.source || anchor.session!==current.session) return false;
  if(current.kind==='still' || current.kind==='synthetic') return current.revision>anchor.revision;
  return Number.isFinite(current.time) && Number.isFinite(anchor.time) && current.time>anchor.time+.04;
}
