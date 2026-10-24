// POST /api/changes — every update of Финя from the very start, for «Все обновления»
// in the Mini App. Open to every member.
import { allChanges } from '../lib/changelog.js';

export default async function () {
  return { entries: allChanges() };
}
