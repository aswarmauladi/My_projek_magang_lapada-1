const maxImageBytes = 2 * 1024 * 1024;

function parseSupportedImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 3 * 1024 * 1024) return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;

  const image = Buffer.from(match[2], 'base64');
  if (!image.length || image.length > maxImageBytes || image.toString('base64') !== match[2]) return null;

  if (match[1] === 'jpeg') {
    if (image[0] !== 0xff || image[1] !== 0xd8 || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
      return null;
    }
  } else if (match[1] === 'png') {
    if (!image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  } else if (image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  return { mimeType: `image/${match[1]}`, buffer: image };
}

module.exports = { maxImageBytes, parseSupportedImage };
