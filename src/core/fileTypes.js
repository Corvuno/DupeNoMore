'use strict';

const IMAGE_EXTENSIONS = new Set([
  'jpg','jpeg','png','gif','bmp','tiff','tif','webp','heic','heif',
  'avif','jxl','ico','svg','psd','raw','cr2','cr3','nef','orf',
  'arw','dng','rw2','raf','srw','x3f','3fr','mef','mrw','pef'
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4','mov','avi','mkv','wmv','flv','webm','m4v','mpg','mpeg',
  '3gp','3g2','mts','m2ts','ts','vob','ogv','mxf','f4v'
]);

const DOCUMENT_EXTENSIONS = new Set([
  'pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp',
  'txt','csv','rtf','md','epub'
]);

function getActiveExtensions(config) {
  const exts = new Set();
  const cfgExts = config.filters?.extensions || [];

  if (cfgExts.length > 0) {
    for (const e of cfgExts) exts.add(e.toLowerCase().replace(/^\./, ''));
  } else {
    for (const e of IMAGE_EXTENSIONS) exts.add(e);
  }

  if (config.filters?.includeVideos) {
    for (const e of VIDEO_EXTENSIONS) exts.add(e);
  }

  return exts;
}

function isImageFile(ext) {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

function isVideoFile(ext) {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

module.exports = { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, DOCUMENT_EXTENSIONS, getActiveExtensions, isImageFile, isVideoFile };
