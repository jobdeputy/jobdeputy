/**
 * Starts the browser's download of `url`, saved as `fileName` (#33 piece 6b3). The API's link is
 * a 5-minute S3 link whose answer names the file (an attachment under its uploaded name, in UTF-8:
 * apps/api/src/documents.ts `attachment`); browsers ignore `download` on another site's link, so
 * it names only a same-site one, such as the fake API's.
 */
export function saveFile(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}
