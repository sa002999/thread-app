const postList = document.querySelector('[data-post-list]');
const detailRoot = document.querySelector('[data-post-detail]');
let nextCursor = null;
let loadingPosts = false;
let exhaustedPosts = false;
let viewer = null;

async function loadViewer() {
  try {
    const response = await fetch('/api/auth/me');
    viewer = response.ok ? await response.json() : null;
  } catch {
    viewer = null;
  }
  window.threadViewer = viewer;
  document.dispatchEvent(new Event('thread-viewer-ready'));
  const composer = document.querySelector('[data-create-post]');
  if (composer && viewer) composer.classList.remove('hidden');
}

function showListError() {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col items-center gap-3 p-8 text-center';
  wrapper.setAttribute('role', 'alert');
  const message = document.createElement('p');
  message.className = 'text-sm text-red-700';
  message.textContent = '載入失敗，請稍後重試。';
  const retry = document.createElement('button');
  retry.className = 'rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-900';
  retry.type = 'button';
  retry.textContent = '重試';
  retry.addEventListener('click', () => loadPosts());
  wrapper.append(message, retry);
  postList.append(wrapper);
}

function renderPost(post) {
  const template = document.querySelector('#post-card-template');
  const card = template.content.firstElementChild.cloneNode(true);
  const body = card.querySelector('[data-post-body]');
  card.dataset.postId = post.id;
  card.querySelector('[data-author]').textContent = post.author.display_name;
  const time = card.querySelector('[data-created-at]');
  time.dateTime = post.created_at;
  time.textContent = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.created_at));
  body.textContent = post.body || '此貼文已刪除';
  body.href = `/posts/${post.id}`;
  card.querySelector('[data-reply-count]').textContent = post.reply_count ? `${post.reply_count} 則回覆` : '回覆';
  card.querySelector('[data-like-count]').textContent = post.like_count ? `${post.like_count} 個讚` : '讚';
  const likeButton = card.querySelector('[data-like-button]');
  likeButton.setAttribute('aria-pressed', String(post.liked_by_me));
  likeButton.setAttribute('aria-label', post.liked_by_me ? '取消貼文按讚' : '按讚貼文');
  likeButton.querySelector('i').classList.toggle('fa-solid', post.liked_by_me);
  likeButton.querySelector('i').classList.toggle('fa-regular', !post.liked_by_me);
  likeButton.classList.toggle('text-rose-600', post.liked_by_me);
  const imageContainer = card.querySelector('[data-post-images]');
  const displayImages = post.deleted ? [] : post.images.filter((image) => image.url);
  if (displayImages.length) {
    imageContainer.hidden = false;
    imageContainer.classList.add(displayImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2');
    displayImages.forEach((image) => {
      const img = document.createElement('img');
      img.className = 'max-h-80 w-full rounded-xl border border-neutral-200 object-cover';
      img.src = image.url;
      img.alt = '貼文圖片';
      img.loading = 'lazy';
      imageContainer.append(img);
    });
  }
  const more = card.querySelector('[aria-label="更多貼文操作"]');
  more.remove();
  if (post.deleted) {
    body.classList.add('text-neutral-500', 'italic');
    card.querySelectorAll('[data-like-button]').forEach((button) => button.remove());
  }
  return card;
}

document.addEventListener('comment-created', (event) => {
  if (event.detail.parentId) return;
  const card = document.querySelector(`[data-post-card][data-post-id="${event.detail.postId}"]`);
  const counter = card?.querySelector('[data-reply-count]');
  if (!counter) return;
  const currentCount = Number(counter.textContent.match(/\d+/)?.[0] || 0);
  counter.textContent = `${currentCount + 1} 則回覆`;
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-like-button], [data-comment-like]');
  if (!button || button.disabled) return;
  event.preventDefault();
  if (!window.threadViewer) await loadViewer();
  if (!window.threadViewer) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const comment = button.matches('[data-comment-like]');
  const card = button.closest(comment ? '[data-comment-card]' : '[data-post-card]');
  const id = comment ? card?.dataset.commentId : card?.dataset.postId;
  if (!id) return;
  button.disabled = true;
  try {
    const response = await fetch(comment ? `/api/comments/${id}/like` : `/api/posts/${id}/like`, {
      method: 'POST', headers: { 'X-CSRF-Token': window.threadViewer.csrf_token },
    });
    const result = await response.json();
    if (response.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!response.ok) throw new Error(result.detail || '按讚操作失敗');
    const count = button.querySelector(comment ? '[data-comment-like-count]' : '[data-like-count]');
    count.textContent = result.like_count ? `${result.like_count} 個讚` : '讚';
    button.setAttribute('aria-pressed', String(result.liked));
    button.setAttribute('aria-label', result.liked ? (comment ? '取消留言按讚' : '取消貼文按讚') : (comment ? '按讚留言' : '按讚貼文'));
    button.querySelector('i').classList.toggle('fa-solid', result.liked);
    button.querySelector('i').classList.toggle('fa-regular', !result.liked);
    button.classList.toggle('text-rose-600', result.liked);
  } catch (error) {
    window.alert(error.message || '連線失敗，請稍後重試');
  } finally { button.disabled = false; }
});

function setEmptyList() {
  const empty = document.createElement('div');
  empty.className = 'p-8 text-center text-neutral-600';
  empty.setAttribute('role', 'status');
  empty.innerHTML = '<i class="fa-regular fa-comment-dots mb-3 text-2xl" aria-hidden="true"></i><p>目前還沒有貼文</p>';
  postList.replaceChildren(empty);
}

async function loadPosts(reset = false) {
  if (loadingPosts || (exhaustedPosts && !reset)) return;
  loadingPosts = true;
  if (reset) {
    nextCursor = null;
    exhaustedPosts = false;
    postList.replaceChildren();
  }
  postList.querySelector('[role="alert"]')?.remove();
  const loader = document.createElement('div');
  loader.className = 'p-8 text-center text-neutral-600';
  loader.setAttribute('role', 'status');
  loader.innerHTML = '<i class="fa-solid fa-spinner animate-spin" aria-hidden="true"></i><span class="ml-2">載入中…</span>';
  postList.append(loader);
  try {
    const query = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : '';
    const response = await fetch(`/api/posts${query}`);
    if (!response.ok) throw new Error('載入失敗');
    const result = await response.json();
    loader.remove();
    result.items.forEach((post) => postList.append(renderPost(post)));
    nextCursor = result.next_cursor;
    exhaustedPosts = !nextCursor;
    if (!result.items.length && !postList.querySelector('[data-post-card]')) setEmptyList();
    if (nextCursor) {
      let sentinel = postList.querySelector('[data-list-sentinel]');
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.className = 'h-1';
        sentinel.dataset.listSentinel = '';
        postList.append(sentinel);
      }
      observer.observe(sentinel);
    }
  } catch {
    loader.remove();
    showListError();
  } finally {
    loadingPosts = false;
  }
}

const observer = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) loadPosts();
}, { rootMargin: '400px' });

async function loadPostDetail() {
  const postId = location.pathname.split('/').filter(Boolean).at(-1);
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`);
    if (!response.ok) throw new Error('not found');
    const post = await response.json();
    const card = renderPost(post);
    card.classList.remove('border-b');
    const body = card.querySelector('[data-post-body]');
    const detailBody = document.createElement('p');
    detailBody.className = body.className;
    detailBody.dataset.postBody = '';
    detailBody.textContent = post.body || '此貼文已刪除';
    body.replaceWith(detailBody);
    const more = document.createElement('div');
    more.className = 'mt-3 flex flex-wrap gap-2';
    card.querySelector('.min-w-0.flex-1').append(more);
    if (!post.deleted && viewer?.id === post.author.id) {
      const edit = document.createElement('button');
      edit.className = 'min-h-10 rounded-full px-3 text-sm font-medium hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-900';
      edit.type = 'button'; edit.textContent = '編輯'; edit.dataset.editPost = '';
      edit.addEventListener('click', () => beginPostEdit(card, post));
      const remove = document.createElement('button');
      remove.className = 'min-h-10 rounded-full px-3 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-neutral-900';
      remove.type = 'button'; remove.textContent = '刪除';
      remove.addEventListener('click', () => deletePost(post.id));
      more.append(edit, remove);
    }
    detailRoot.replaceChildren(card);
  } catch {
    detailRoot.innerHTML = '<div class="p-8 text-center" role="alert"><p class="text-neutral-700">找不到這篇貼文，或目前無法載入。</p><a class="mt-3 inline-block underline" href="/">回到首頁</a></div>';
  }
}

function beginPostEdit(card, post) {
  const body = card.querySelector('[data-post-body]');
  const form = document.createElement('form');
  form.className = 'mt-3 space-y-3';
  const input = document.createElement('textarea');
  input.className = 'min-h-32 w-full rounded-xl border border-neutral-300 p-3 focus:border-neutral-700 focus:ring-2 focus:ring-neutral-200';
  input.maxLength = 500; input.value = body.textContent;
  input.value = body.textContent;
  let existingImages = [...post.images];
  let selectedFiles = [];
  const pickerLabel = document.createElement('label'); pickerLabel.className = 'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-semibold hover:bg-neutral-100'; pickerLabel.htmlFor = `edit-images-${post.id}`; pickerLabel.textContent = '加入圖片';
  const picker = document.createElement('input'); picker.className = 'sr-only'; picker.type = 'file'; picker.id = `edit-images-${post.id}`; picker.accept = 'image/jpeg,image/png,image/webp'; picker.multiple = true;
  const previews = document.createElement('div'); previews.className = 'flex flex-wrap gap-2';
  const renderEditImages = () => {
    previews.querySelectorAll('img[src^="blob:"]').forEach((image) => URL.revokeObjectURL(image.src));
    previews.replaceChildren();
    existingImages.forEach((image, index) => {
      if (!image.url) return;
      const wrapper = document.createElement('div'); wrapper.className = 'relative';
      const img = document.createElement('img'); img.className = 'size-20 rounded-lg object-cover'; img.src = image.url; img.alt = `目前圖片 ${index + 1}`;
      const remove = document.createElement('button'); remove.className = 'absolute right-1 top-1 size-7 rounded-full bg-neutral-950/75 text-white'; remove.type = 'button'; remove.setAttribute('aria-label', `移除圖片 ${index + 1}`); remove.textContent = '×';
      remove.addEventListener('click', () => { existingImages.splice(index, 1); renderEditImages(); }); wrapper.append(img, remove); previews.append(wrapper);
    });
    showImagePreviews(previews, selectedFiles, (index) => { selectedFiles.splice(index, 1); renderEditImages(); });
  };
  renderEditImages();
  picker.addEventListener('change', async () => {
    const error = form.querySelector('[data-edit-error]'); error.hidden = true;
    try { selectedFiles.push(...await prepareImages(picker.files, existingImages.length + selectedFiles.length)); renderEditImages(); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
    picker.value = '';
  });
  const actions = document.createElement('div'); actions.className = 'flex flex-wrap items-center gap-2';
  const save = document.createElement('button'); save.className = 'rounded-full bg-neutral-950 px-4 py-2 text-sm font-semibold text-white'; save.type = 'submit'; save.textContent = '儲存';
  const cancel = document.createElement('button'); cancel.className = 'rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold'; cancel.type = 'button'; cancel.textContent = '取消';
  const error = document.createElement('p'); error.className = 'text-sm text-red-700'; error.setAttribute('role', 'alert'); error.hidden = true;
  actions.append(save, cancel, pickerLabel); form.append(input, picker, previews, actions, error); body.replaceWith(form); input.focus();
  cancel.addEventListener('click', () => {
    previews.querySelectorAll('img[src^="blob:"]').forEach((image) => URL.revokeObjectURL(image.src));
    form.replaceWith(body);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const uploaded = await uploadImages(selectedFiles, viewer.csrf_token);
      const images = [...existingImages.map(({ object_key, content_type, byte_size }) => ({ object_key, content_type, byte_size })), ...uploaded];
      const response = await fetch(`/api/posts/${post.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': viewer.csrf_token }, body: JSON.stringify({ body: input.value, images }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || '儲存失敗');
      body.textContent = result.body;
      previews.querySelectorAll('img[src^="blob:"]').forEach((image) => URL.revokeObjectURL(image.src));
      form.replaceWith(body);
    } catch (err) { error.textContent = err.message || '連線失敗，請稍後重試'; error.hidden = false; save.disabled = false; }
  });
}

async function deletePost(postId) {
  if (!window.confirm('刪除這篇貼文？留言串會保留。')) return;
  try {
    const response = await fetch(`/api/posts/${postId}`, { method: 'DELETE', headers: { 'X-CSRF-Token': viewer.csrf_token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || '刪除失敗');
    await loadPostDetail();
  } catch (error) { window.alert(error.message || '連線失敗，請稍後重試'); }
}

async function setupComposer() {
  const form = document.querySelector('[data-create-post]');
  if (!form) return;
  const picker = form.querySelector('[data-post-images]');
  const preview = form.querySelector('[data-post-image-preview]');
  let selectedFiles = [];
  const renderComposerImages = () => showImagePreviews(preview, selectedFiles, (index) => {
    selectedFiles.splice(index, 1);
    renderComposerImages();
  });
  picker.addEventListener('change', async () => {
    const error = form.querySelector('[data-create-error]'); error.hidden = true;
    try { selectedFiles.push(...await prepareImages(picker.files, selectedFiles.length)); renderComposerImages(); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
    picker.value = '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!viewer) { location.href = `/login?next=${encodeURIComponent('/')}`; return; }
    const button = form.querySelector('[type="submit"]');
    const error = form.querySelector('[data-create-error]');
    button.disabled = true; error.hidden = true;
    try {
      const images = await uploadImages(selectedFiles, viewer.csrf_token);
      const response = await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': viewer.csrf_token }, body: JSON.stringify({ body: form.elements.body.value, images }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || '發布失敗');
      form.reset(); selectedFiles = []; showImagePreviews(preview, [], () => {}); await loadPosts(true);
    } catch (err) { error.textContent = err.message || '連線失敗，請稍後重試'; error.hidden = false; }
    finally { button.disabled = false; }
  });
}

async function startPostsPage() {
  const viewerRequest = loadViewer();
  await setupComposer();
  if (postList) await loadPosts(true);
  await viewerRequest;
  if (detailRoot) await loadPostDetail();
}

if (document.querySelector('#post-card-template')) startPostsPage();
else document.addEventListener('site-chrome-ready', startPostsPage, { once: true });
