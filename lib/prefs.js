// Small JSON file for user choices that should survive restarts.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function createPrefs(file) {
  let data = { hidden: {} };
  try {
    data = { hidden: {}, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // first run
  }

  function save() {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  return {
    hiddenSet: () => new Set(Object.keys(data.hidden).map(Number)),
    hiddenList: () => Object.entries(data.hidden).map(([appid, name]) => ({ appid: Number(appid), name })),
    setHidden(appid, name, hidden) {
      if (hidden) data.hidden[appid] = name || `App ${appid}`;
      else delete data.hidden[appid];
      save();
    },
  };
}
