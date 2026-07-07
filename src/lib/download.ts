// Client-side download helpers.
//
// CSVs are UTF-8, but Excel (and other spreadsheet apps) default to the legacy
// Windows-1252 code page unless the file starts with a UTF-8 byte-order mark.
// Without the BOM, characters like the em dash "—" render as mojibake
// ("â€”"). Prepending the BOM makes Excel detect UTF-8 correctly.
const UTF8_BOM = '﻿';

/** Trigger a browser download of a CSV string as a UTF-8 (BOM-prefixed) file. */
export function downloadCsv(csv: string, filename: string) {
  const body = csv.startsWith(UTF8_BOM) ? csv : UTF8_BOM + csv;
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
