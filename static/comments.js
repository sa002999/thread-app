const commentsList = document.querySelector('[data-comments-list]');
const commentThreads = new Map();

function formatCommentTime(value) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function renderComment(comment) {
  const template = document.querySelector('#comment-card-template');
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.commentId = comment.id;
  card.dataset.postId = comment.post_id;
  card.querySelector('[data-comment-author]').textContent = comment.author.display_name;
  const time = card.querySelector('[data-comment-created-at]');
  time.dateTime = comment.created_at;
  time.textContent = formatCommentTime(comment.created_at);
  const body = card.querySelector('[data-comment-body]');
  body.textContent = comment.body;
  if (comment.deleted) body.classList.add('text-neutral-500', 'italic');
  const count = card.querySelector('[data-direct-reply-count]');
  count.textContent = `${comment.reply_count} 則回覆`;
  const toggle = card.querySelector('[data-toggle-replies]');
  toggle.hidden = comment.reply_count === 0;
  const children = card.querySelector('[data-comment-children]');
  const state = { cursor: null, loading: false, loaded: false, exhausted: false, children, toggle, comment };
  commentThreads.set(Number(comment.id), state);
  const imageBox = card.querySelector('[data-comment-images]');
  const shownImages = comment.deleted ? [] : comment.images.filter((image) => image.url);
  if (shownImages.length) {
    imageBox.hidden = false;
    imageBox.classList.add(shownImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2');
    shownImages.forEach((image) => {
      const img = document.createElement('img');
      img.className = 'max-h-80 w-full rounded-xl border border-neutral-200 object-cover';
      img.src = image.url; img.alt = '留言圖片'; img.loading = 'lazy'; imageBox.append(img);
      img.dataset.objectKey = image.object_key; img.dataset.contentType = image.content_type; img.dataset.byteSize = image.byte_size;
    });
  }
  const likeButton = card.querySelector('[data-comment-like]');
  likeButton.querySelector('[data-comment-like-count]').textContent = comment.like_count ? `${comment.like_count} 個讚` : '讚';
  likeButton.setAttribute('aria-pressed', String(comment.liked_by_me));
  likeButton.setAttribute('aria-label', comment.liked_by_me ? '取消留言按讚' : '按讚留言');
  likeButton.querySelector('i').classList.toggle('fa-solid', comment.liked_by_me);
  likeButton.querySelector('i').classList.toggle('fa-regular', !comment.liked_by_me);
  likeButton.classList.toggle('text-rose-600', comment.liked_by_me);
  if (comment.deleted) likeButton.remove();
  if (window.threadViewer?.id === comment.author.id && !comment.deleted) {
    const controls = card.querySelector('[aria-label="更多留言操作"]');
    controls.replaceChildren();
    controls.className = 'flex h-9 shrink-0 items-center gap-1';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = '編輯'; edit.dataset.editComment = '';
    edit.className = 'rounded-full px-2 py-1 text-xs font-medium hover:bg-neutral-100';
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '刪除'; remove.dataset.deleteComment = '';
    remove.className = 'rounded-full px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50';
    controls.append(edit, remove);
  } else card.querySelector('[aria-label="更多留言操作"]').remove();
  if (comment.has_author_reply) {
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.dataset.autoExpand = '';
    children.hidden = false;
    queueMicrotask(() => loadReplies(comment.id));
  }
  return card;
}

function addPagingControl(container, label, handler) {
  container.querySelector('[data-comment-paging]')?.remove();
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.commentPaging = '';
  button.className = 'my-2 rounded-full px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100';
  button.textContent = label; button.addEventListener('click', handler);
  container.append(button);
}

function observeMore(container, handler) {
  const sentinel = document.createElement('div'); sentinel.className = 'h-1'; sentinel.dataset.commentSentinel = '';
  container.append(sentinel);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect(); sentinel.remove(); handler();
    }
  }, { rootMargin: '300px' });
  observer.observe(sentinel);
}

async function loadReplies(parentId, reset = false) {
  const state = commentThreads.get(Number(parentId));
  if (!state || state.loading || (state.exhausted && !reset)) return;
  state.loading = true;
  state.children.querySelector('[data-comment-paging]')?.remove();
  if (reset) { state.cursor = null; state.exhausted = false; state.children.replaceChildren(); }
  const status = document.createElement('p');
  status.className = 'py-2 text-sm text-neutral-500'; status.textContent = '載入回覆中…';
  state.children.append(status);
  try {
    const query = state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : '';
    const response = await fetch(`/api/comments/${parentId}/replies${query}`);
    if (!response.ok) throw new Error('無法載入回覆，請重試');
    const result = await response.json();
    status.remove();
    result.items.forEach((comment) => state.children.append(renderComment(comment)));
    state.cursor = result.next_cursor; state.exhausted = !state.cursor; state.loaded = true;
    if (state.cursor) observeMore(state.children, () => loadReplies(parentId));
    if (!result.items.length && !state.children.querySelector('[data-comment-card]')) {
      const empty = document.createElement('p'); empty.className = 'py-2 text-sm text-neutral-500'; empty.textContent = '目前還沒有回覆'; state.children.append(empty);
    }
  } catch (error) {
    status.remove(); addPagingControl(state.children, '載入失敗，重試', () => loadReplies(parentId));
  } finally { state.loading = false; }
}

function toggleReplies(button) {
  const card = button.closest('[data-comment-card]');
  const id = Number(card.dataset.commentId);
  const state = commentThreads.get(id);
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  state.children.hidden = expanded;
  if (!expanded && !state.loaded) loadReplies(id);
}

async function loadRootComments(cursor = null, reset = false) {
  if (!commentsList || commentsList.dataset.loading === 'true') return;
  commentsList.dataset.loading = 'true';
  commentsList.querySelector('[data-comment-paging]')?.remove();
  if (reset) { commentsList.dataset.cursor = ''; commentsList.replaceChildren(); }
  const status = document.createElement('p');
  status.className = 'p-4 text-center text-sm text-neutral-500'; status.textContent = '載入留言中…';
  commentsList.append(status);
  const postId = location.pathname.split('/').filter(Boolean).at(-1);
  try {
    const pageCursor = cursor ?? commentsList.dataset.cursor;
    const query = pageCursor ? `?cursor=${encodeURIComponent(pageCursor)}` : '';
    const response = await fetch(`/api/posts/${postId}/comments${query}`);
    if (!response.ok) throw new Error('無法載入留言，請重試');
    const result = await response.json(); status.remove();
    result.items.forEach((comment) => commentsList.append(renderComment(comment)));
    commentsList.dataset.cursor = result.next_cursor || '';
    commentsList.dataset.exhausted = String(!result.next_cursor);
    if (!result.items.length && !commentsList.querySelector('[data-comment-card]')) {
      const empty = document.createElement('p'); empty.className = 'p-4 text-center text-sm text-neutral-500'; empty.textContent = '目前還沒有留言'; commentsList.append(empty);
    }
    if (result.next_cursor) observeMore(commentsList, () => loadRootComments(commentsList.dataset.cursor));
  } catch {
    status.remove(); addPagingControl(commentsList, '載入失敗，重試', () => loadRootComments(commentsList.dataset.cursor || null));
  } finally { commentsList.dataset.loading = 'false'; }
}

function beginCommentEdit(card) {
  const commentId = card.dataset.commentId;
  const body = card.querySelector('[data-comment-body]');
  if (!body || card.querySelector('[data-comment-edit-form]')) return;
  const form = document.createElement('form'); form.dataset.commentEditForm = ''; form.className = 'mt-2 space-y-2';
  const input = document.createElement('textarea'); input.maxLength = 500; input.value = body.textContent === '此留言已刪除' ? '' : body.textContent;
  input.className = 'min-h-24 w-full rounded-xl border border-neutral-300 p-3';
  const error = document.createElement('p'); error.className = 'text-sm text-red-700'; error.hidden = true;
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = '儲存'; save.className = 'rounded-full bg-neutral-950 px-4 py-2 text-sm font-semibold text-white';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.className = 'rounded-full border px-4 py-2 text-sm';
  const imageBox = card.querySelector('[data-comment-images]');
  let existingImages = Array.from(imageBox.querySelectorAll('img')).map((image, index) => ({
    object_key: image.dataset.objectKey, content_type: image.dataset.contentType,
    byte_size: Number(image.dataset.byteSize), url: image.src, position: index,
  }));
  let selectedFiles = [];
  const pickerLabel = document.createElement('label'); pickerLabel.className = 'inline-flex cursor-pointer rounded-full px-3 py-2 text-sm font-semibold hover:bg-neutral-100'; pickerLabel.textContent = '加入圖片';
  const picker = document.createElement('input'); picker.className = 'sr-only'; picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp'; picker.multiple = true;
  pickerLabel.append(picker);
  const previews = document.createElement('div'); previews.className = 'flex flex-wrap gap-2';
  const renderImages = () => {
    previews.querySelectorAll('img[src^="blob:"]').forEach((image) => URL.revokeObjectURL(image.src));
    previews.replaceChildren();
    existingImages.forEach((image, index) => {
      const wrap = document.createElement('div'); wrap.className = 'relative';
      const img = document.createElement('img'); img.className = 'size-20 rounded-lg object-cover'; img.src = image.url; img.alt = `目前圖片 ${index + 1}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.className = 'absolute right-1 top-1 size-7 rounded-full bg-neutral-950/75 text-white'; remove.setAttribute('aria-label', `移除圖片 ${index + 1}`);
      remove.addEventListener('click', () => { existingImages.splice(index, 1); renderImages(); }); wrap.append(img, remove); previews.append(wrap);
    });
    showImagePreviews(previews, selectedFiles, (index) => { selectedFiles.splice(index, 1); renderImages(); });
  };
  renderImages();
  picker.addEventListener('change', async () => {
    try { selectedFiles.push(...await prepareImages(picker.files, existingImages.length + selectedFiles.length)); renderImages(); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
    picker.value = '';
  });
  form.append(input, pickerLabel, previews, save, cancel, error); body.replaceWith(form); input.focus();
  cancel.addEventListener('click', () => {
    previews.querySelectorAll('img[src^="blob:"]').forEach((image) => URL.revokeObjectURL(image.src));
    form.replaceWith(body);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const uploaded = selectedFiles.length ? await uploadImages(selectedFiles, window.threadViewer.csrf_token) : [];
      const images = [...existingImages.map(({ object_key, content_type, byte_size }) => ({ object_key, content_type, byte_size })), ...uploaded];
      const response = await fetch(`/api/comments/${commentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.threadViewer.csrf_token }, body: JSON.stringify({ body: input.value, images }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.detail || '儲存失敗');
      body.textContent = result.body; form.replaceWith(body);
      const box = card.querySelector('[data-comment-images]');
      box.replaceChildren(); box.hidden = !result.images.length;
      result.images.forEach((image) => {
        const img = document.createElement('img'); img.className = 'max-h-80 w-full rounded-xl border border-neutral-200 object-cover';
        img.src = image.url; img.alt = '留言圖片'; img.loading = 'lazy';
        img.dataset.objectKey = image.object_key; img.dataset.contentType = image.content_type; img.dataset.byteSize = image.byte_size;
        box.append(img);
      });
      previews.querySelectorAll('img[src^="blob:"]').forEach((image) => URL.revokeObjectURL(image.src));
    } catch (err) { error.textContent = err.message || '連線失敗，請稍後重試'; error.hidden = false; save.disabled = false; }
  });
}

async function deleteComment(card) {
  if (!window.confirm('刪除這則留言？下方回覆會保留。')) return;
  try {
    const response = await fetch(`/api/comments/${card.dataset.commentId}`, { method: 'DELETE', headers: { 'X-CSRF-Token': window.threadViewer.csrf_token } });
    const result = await response.json(); if (!response.ok) throw new Error(result.detail || '刪除失敗');
    card.querySelector('[data-comment-body]').textContent = '此留言已刪除';
    card.querySelector('[data-comment-body]').classList.add('text-neutral-500', 'italic');
    card.querySelector('[data-comment-images]').replaceChildren(); card.querySelector('[data-comment-images]').hidden = true;
    card.querySelectorAll('[data-comment-reply], [data-edit-comment], [data-delete-comment]').forEach((button) => button.remove());
  } catch (error) { window.alert(error.message || '連線失敗，請稍後重試'); }
}

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle-replies]'); if (toggle) toggleReplies(toggle);
  const edit = event.target.closest('[data-edit-comment]'); if (edit) beginCommentEdit(edit.closest('[data-comment-card]'));
  const remove = event.target.closest('[data-delete-comment]'); if (remove) deleteComment(remove.closest('[data-comment-card]'));
});

document.addEventListener('comment-created', async (event) => {
  const { comment, parentId } = event.detail;
  if (!parentId) {
    if (!commentsList) return;
    commentsList.querySelector('[data-comment-paging]')?.remove();
    commentsList.querySelector('[data-comment-empty]')?.remove();
    commentsList.querySelectorAll('p').forEach((item) => { if (item.textContent === '目前還沒有留言') item.remove(); });
    commentsList.prepend(renderComment(comment));
    return;
  }
  const state = commentThreads.get(Number(parentId));
  if (!state) return;
  state.comment.reply_count += 1;
  state.toggle.hidden = false;
  state.toggle.querySelector('[data-direct-reply-count]').textContent = `${state.comment.reply_count} 則回覆`;
  state.toggle.setAttribute('aria-expanded', 'true'); state.children.hidden = false;
  if (!state.loaded) await loadReplies(parentId);
  if (!state.children.querySelector(`[data-comment-id="${comment.id}"]`)) state.children.append(renderComment(comment));
});

document.addEventListener('thread-viewer-ready', () => {
  if (commentsList) loadRootComments(null, true);
}, { once: true });
