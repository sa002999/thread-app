async function loadSiteChrome() {
  const [headerResponse, cardResponse, commentResponse, modalResponse, controlsResponse] = await Promise.all([
    fetch('/static/header.html'),
    fetch('/static/post-card.html'),
    fetch('/static/comment-card.html'),
    fetch('/static/reply-modal.html'),
    fetch('/static/content-controls.html'),
  ]);
  if (![headerResponse, cardResponse, commentResponse, modalResponse, controlsResponse].every((response) => response.ok)) return;
  const [header, card, comment, modal, controls] = await Promise.all([
    headerResponse.text(), cardResponse.text(), commentResponse.text(), modalResponse.text(), controlsResponse.text(),
  ]);
  document.querySelector('[data-site-header]')?.insertAdjacentHTML('afterbegin', header);
  document.querySelector('main')?.insertAdjacentHTML('beforeend', card);
  document.querySelector('main')?.insertAdjacentHTML('beforeend', comment);
  document.querySelector('main')?.insertAdjacentHTML('beforeend', controls);
  document.body.insertAdjacentHTML('beforeend', modal);
  document.dispatchEvent(new Event('site-chrome-ready'));
}

function setupReplyModal() {
  const modal = document.querySelector('#reply-modal');
  if (!modal) return;

  let opener;
  let selectedFiles = [];
  let previewUrls = [];
  const form = modal.querySelector('[data-reply-form]');
  const textarea = modal.querySelector('[data-reply-input]');
  const fileInput = modal.querySelector('[data-reply-images]');
  const preview = modal.querySelector('[data-reply-preview]');
  const error = modal.querySelector('[data-reply-error]');
  const submit = modal.querySelector('[data-reply-submit]');
  let submitting = false;

  function renderPreviews() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
    preview.replaceChildren(...selectedFiles.map((file, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'relative';
      const image = document.createElement('img');
      image.className = 'size-20 rounded-lg object-cover';
      image.alt = `所選圖片 ${index + 1} 預覽`;
      image.src = URL.createObjectURL(file);
      previewUrls.push(image.src);
      const remove = document.createElement('button');
      remove.className = 'absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-neutral-950/75 text-white';
      remove.type = 'button';
      remove.setAttribute('aria-label', `移除圖片 ${index + 1}`);
      remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      remove.addEventListener('click', () => {
        selectedFiles.splice(index, 1);
        renderPreviews();
      });
      wrapper.append(image, remove);
      return wrapper;
    }));
  }

  function hasDraft() {
    return textarea.value.trim().length > 0 || selectedFiles.length > 0;
  }

  function requestClose() {
    if (submitting) return;
    if (hasDraft() && !window.confirm('放棄這則回覆？')) return;
    modal.close();
  }

  function open(button) {
    opener = button;
    const context = button.closest('[data-post-card], [data-comment-card]');
    const author = context?.querySelector('[data-author], [data-comment-author]')?.textContent?.trim();
    const body = context?.querySelector('[data-post-body], [data-comment-body]')?.textContent?.trim();
    modal.querySelector('[data-context-author]').textContent = button.closest('[data-comment-card]') ? `回覆 ${author || '留言'}` : `回覆 ${author || '貼文'}`;
    modal.querySelector('[data-context-body]').textContent = body || '（沒有文字內容）';
    modal.dataset.postId = context?.dataset.postId || context?.closest('[data-post-card]')?.dataset.postId || '';
    modal.dataset.parentId = context?.matches('[data-comment-card]') ? context.dataset.commentId : '';
    textarea.value = '';
    selectedFiles = [];
    renderPreviews();
    error.hidden = true;
    modal.showModal();
    textarea.focus();
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reply-link], [data-comment-reply]');
    if (button) {
      event.preventDefault();
      open(button);
    }
  });
  modal.querySelector('[data-modal-close]').addEventListener('click', requestClose);
  modal.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestClose();
  });
  modal.addEventListener('close', () => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
    selectedFiles = [];
    textarea.value = '';
    fileInput.value = '';
    preview.replaceChildren();
    error.hidden = true;
    opener?.focus();
    opener = undefined;
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) event.preventDefault();
  });
  fileInput.addEventListener('change', async () => {
    const incoming = Array.from(fileInput.files || []);
    error.hidden = true;
    try {
      selectedFiles.push(...await prepareImages(incoming, selectedFiles.length));
      renderPreviews();
    } catch (err) { error.textContent = err.message; error.hidden = false; }
    fileInput.value = '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const body = textarea.value.trim();
    if (!body && !selectedFiles.length) {
      error.textContent = '請輸入回覆內容或加入圖片'; error.hidden = false; return;
    }
    let account = window.threadViewer;
    if (!account) {
      try {
        const me = await fetch('/api/auth/me');
        if (me.ok) account = await me.json();
      } catch {}
    }
    if (!account) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    submit.disabled = true;
    submitting = true;
    try {
      const images = await uploadImages(selectedFiles, account.csrf_token);
      const parentId = modal.dataset.parentId;
      const postId = modal.dataset.postId;
      const endpoint = parentId ? `/api/comments/${parentId}/replies` : `/api/posts/${postId}/comments`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': account.csrf_token },
        body: JSON.stringify({ body, images }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || '送出失敗');
      document.dispatchEvent(new CustomEvent('comment-created', { detail: { comment: result, postId, parentId: parentId ? Number(parentId) : null } }));
      modal.close();
    } catch (err) {
      error.textContent = err.message || '連線失敗，請稍後重試'; error.hidden = false;
    } finally { submitting = false; submit.disabled = false; }
  });

}

function setupContentControls() {
  const editTemplate = document.querySelector('#content-edit-template');
  const deleteDialog = document.querySelector('#delete-confirm');
  if (!editTemplate || !deleteDialog) return;
  let deleteTarget;

  document.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-content]');
    if (editButton) {
      const card = editButton.closest('[data-post-card], [data-comment-card]');
      const body = card?.querySelector('[data-post-body], [data-comment-body]');
      if (!card || !body || card.querySelector('[data-content-edit-form]')) return;
      const form = editTemplate.content.firstElementChild.cloneNode(true);
      const input = form.querySelector('[data-edit-input]');
      const label = form.querySelector('[data-edit-label]');
      label.textContent = card.matches('[data-comment-card]') ? '編輯留言' : '編輯貼文';
      input.value = body.textContent.trim();
      body.replaceWith(form);
      input.focus();
      form.querySelector('[data-edit-cancel]').addEventListener('click', () => form.replaceWith(body));
      form.addEventListener('submit', (submitEvent) => {
        submitEvent.preventDefault();
        if (!input.value.trim()) {
          const error = form.querySelector('[data-edit-error]');
          error.textContent = '內容不可為空';
          error.hidden = false;
          input.focus();
          return;
        }
        body.textContent = input.value.trim();
        form.replaceWith(body);
      });
      form.querySelector('[data-content-delete]').addEventListener('click', () => {
        deleteTarget = { card, body };
        deleteDialog.showModal();
      });
      return;
    }

    const deleteButton = event.target.closest('[data-delete-content]');
    if (deleteButton) {
      deleteTarget = {
        card: deleteButton.closest('[data-post-card], [data-comment-card]'),
        body: deleteButton.closest('[data-post-card], [data-comment-card]')?.querySelector('[data-post-body], [data-comment-body]'),
      };
      if (deleteTarget.card) deleteDialog.showModal();
    }
  });

  deleteDialog.querySelector('[data-delete-cancel]').addEventListener('click', () => deleteDialog.close());
  deleteDialog.querySelector('[data-delete-confirm]').addEventListener('click', () => {
    if (deleteTarget?.body) {
      deleteTarget.body.textContent = deleteTarget.card.matches('[data-comment-card]') ? '此留言已刪除' : '此貼文已刪除';
      deleteTarget.body.classList.add('text-neutral-500', 'italic');
      deleteTarget.card.querySelectorAll('[data-edit-content], [data-delete-content]').forEach((button) => button.remove());
    }
    deleteTarget = undefined;
    deleteDialog.close();
  });
}

function setupListStates() {
  const list = document.querySelector('[data-post-list]');
  if (!list) return;
  const emptyTemplate = document.querySelector('#list-empty-template');
  const errorTemplate = document.querySelector('#list-error-template');
  const loadingTemplate = document.querySelector('#list-loading-template');
  const setState = (template, message) => {
    list.replaceChildren(template.content.cloneNode(true));
    const label = list.querySelector('[data-empty-message]');
    if (label && message) label.textContent = message;
  };
  list.addEventListener('click', (event) => {
    if (!event.target.closest('[data-list-retry]')) return;
    setState(loadingTemplate);
    window.setTimeout(() => setState(errorTemplate), 500);
  });
  document.querySelector('[data-preview-list-state]')?.addEventListener('change', (event) => {
    if (event.target.value === 'empty') setState(emptyTemplate, '目前還沒有貼文');
    if (event.target.value === 'loading') setState(loadingTemplate);
    if (event.target.value === 'error') setState(errorTemplate);
  });
}

loadSiteChrome().catch(() => {});
document.addEventListener('site-chrome-ready', () => {
  setupReplyModal();
  setupContentControls();
  setupListStates();
}, { once: true });
