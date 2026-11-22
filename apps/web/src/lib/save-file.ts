/**
 * Starts the browser's download of `url`, saved as `fileName` (#33 piece 6b3). The API's link is
 * a 5-minute S3 link that sends the file as an attachment under its own name (a link to another
 * site keeps its own name; `download` names a same-site one, such as the fake API's).
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
