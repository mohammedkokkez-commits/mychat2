(function () {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  function showLogin() {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    tabLogin.setAttribute('aria-selected', 'true');
    tabRegister.setAttribute('aria-selected', 'false');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
  }
  function showRegister() {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    tabRegister.setAttribute('aria-selected', 'true');
    tabLogin.setAttribute('aria-selected', 'false');
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
  }
  tabLogin.addEventListener('click', showLogin);
  tabRegister.addEventListener('click', showRegister);

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'حدث خطأ');
    return data;
  }

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      await postJSON('/api/login', { username, password });
      window.location.href = '/chat.html';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('register-error');
    errEl.textContent = '';
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    try {
      await postJSON('/api/register', { username, password });
      errEl.style.color = 'var(--accent-strong)';
      errEl.textContent = 'تم إنشاء الحساب، سجل دخول الآن';
      showLogin();
    } catch (err) {
      errEl.style.color = '';
      errEl.textContent = err.message;
    }
  });

  // If already logged in, skip straight to chat.
  fetch('/api/me').then((res) => {
    if (res.ok) window.location.href = '/chat.html';
  });
})();
