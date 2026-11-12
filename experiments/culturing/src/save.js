// Handing the person a file: a photograph, a video.

/** Save a blob under a name, by way of a link that is clicked and let go. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
