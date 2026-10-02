const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SOURCE_IMAGE_SIZE = 20_000_000;
const MAX_COMPRESSED_IMAGE_SIZE = 5_000_000;

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('圖片轉檔失敗，請換一張圖片')), 'image/webp', quality);
  });
}

async function compressImage(file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('僅支援 JPEG、PNG 或 WebP 圖片');
  if (file.size <= 0 || file.size > MAX_SOURCE_IMAGE_SIZE) throw new Error('原始圖片不可超過 20 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.72, 0.64, 0.56, 0.48]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob.size <= MAX_COMPRESSED_IMAGE_SIZE) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: 'image/webp' });
      }
    }
    throw new Error('壓縮後圖片仍超過 5 MB，請換一張圖片');
  } finally {
    bitmap.close();
  }
}

async function prepareImages(fileList, existingCount = 0) {
  const files = Array.from(fileList || []);
  if (existingCount + files.length > 3) throw new Error('每篇貼文最多附加 3 張圖片');
  return Promise.all(files.map(compressImage));
}

function showImagePreviews(container, files, removeFile) {
  container.querySelectorAll('img[src^="blob:"]').forEach((image) => URL.revokeObjectURL(image.src));
  container.replaceChildren(...files.map((file, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'relative';
    const image = document.createElement('img');
    image.className = 'size-20 rounded-lg object-cover';
    image.alt = `圖片 ${index + 1} 預覽`;
    image.src = URL.createObjectURL(file);
    const remove = document.createElement('button');
    remove.className = 'absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-neutral-950/75 text-white focus-visible:outline-2 focus-visible:outline-white';
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除圖片 ${index + 1}`);
    remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    remove.addEventListener('click', () => {
      URL.revokeObjectURL(image.src);
      removeFile(index);
    });
    wrapper.append(image, remove);
    return wrapper;
  }));
}

async function uploadImages(files, csrfToken) {
  const uploaded = [];
  for (const file of files) {
    const signedResponse = await fetch('/api/uploads/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ content_type: file.type, byte_size: file.size }),
    });
    const signed = await signedResponse.json();
    if (!signedResponse.ok) throw new Error(signed.detail || '無法準備圖片上傳');
    const uploadResponse = await fetch(signed.upload_url, {
      method: 'PUT',
      headers: signed.required_headers,
      body: file,
    });
    if (!uploadResponse.ok) throw new Error('圖片上傳失敗，請稍後重試');
    uploaded.push({ object_key: signed.object_key, content_type: file.type, byte_size: file.size });
  }
  return uploaded;
}
