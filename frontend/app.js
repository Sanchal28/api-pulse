const API_BASE = ''; // served from the same origin as the backend

let mode = 'login'; // 'login' | 'signup'

const form = document.getElementById('authForm');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');
const switchLink = document.getElementById('switchLink');
const switchText = document.getElementById('switchText');
const formTitle = document.getElementById('formTitle');
const formSub = document.getElementById('formSub');

// already signed in? skip straight to the dashboard
if (localStorage.getItem('apipulse_token')) {
  window.location.href = 'dashboard.html';
}

switchLink.addEventListener('click', (e) => {
  e.preventDefault();
  mode = mode === 'login' ? 'signup' : 'login';
  updateFormMode();
});

function updateFormMode() {
  errorBox.style.display = 'none';
  if (mode === 'login') {
    formTitle.textContent = 'Sign in to your account';
    formSub.textContent = 'Monitor incoming and outgoing traffic in real time.';
    submitBtn.textContent = 'Sign in';
    switchText.textContent = "Don't have an account?";
    switchLink.textContent = 'Create one';
  } else {
    formTitle.textContent = 'Create your account';
    formSub.textContent = 'Set up a project in under a minute.';
    submitBtn.textContent = 'Create account';
    switchText.textContent = 'Already have an account?';
    switchLink.textContent = 'Sign in';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';

  try {
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    localStorage.setItem('apipulse_token', data.token);
    localStorage.setItem('apipulse_email', data.user.email);
    window.location.href = 'dashboard.html';
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  }
});
