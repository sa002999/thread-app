const page = document.body.dataset.page;

function nextPage() {
  const value = new URLSearchParams(location.search).get("next") || "/";
  const target = new URL(value, location.origin);
  return target.origin === location.origin ? target.pathname + target.search : "/";
}

async function currentAccount() {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  return response.ok ? response.json() : null;
}

function showError(message) {
  const element = document.querySelector("#form-error");
  element.textContent = message;
  element.hidden = false;
}

if (page === "login" || page === "register") {
  currentAccount().then((account) => {
    if (account) location.replace(nextPage());
  }).catch(() => {});

  document.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const error = document.querySelector("#form-error");
    error.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    data.email = data.email.trim();
    if (page === "register" && data.password !== data.confirm_password) {
      showError("兩次輸入的密碼不一致");
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch(`/api/auth/${page}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const result = await response.json();
        showError(typeof result.detail === "string" ? result.detail : "請檢查輸入資料後重試");
        return;
      }
      location.assign(nextPage());
    } catch {
      showError("連線失敗，請稍後重試");
    } finally {
      button.disabled = false;
    }
  });
} else {
  function setupAccountNav() {
    const nav = document.querySelector("#account-nav");
    if (!nav) return;
    const loginLink = nav.querySelector("a");
    loginLink.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    currentAccount().then((account) => {
    if (!account) return;
    nav.replaceChildren();
    const name = document.createElement("span");
    name.className = "mr-3 text-sm font-medium";
    name.textContent = account.display_name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold hover:bg-neutral-100";
    button.textContent = "登出";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "X-CSRF-Token": account.csrf_token },
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("登出失敗");
        location.reload();
      } catch {
        button.disabled = false;
        alert("登出失敗，請稍後重試");
      }
    });
    nav.append(name, button);
    }).catch(() => {});
  }

  if (document.querySelector("#account-nav")) setupAccountNav();
  else document.addEventListener("site-chrome-ready", setupAccountNav, { once: true });
}
