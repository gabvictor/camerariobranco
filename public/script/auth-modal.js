import { auth, db } from "./firebase-config.js";
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    updateProfile,
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export let ADMIN_EMAIL = "";

// Fetch config immediately
fetch('/api/config')
    .then(res => res.json())
    .then(data => {
        ADMIN_EMAIL = data.adminEmail;
        if (auth.currentUser) {
             checkAdminStatus(auth.currentUser);
        }
    })
    .catch(err => console.error("Error fetching config:", err));

const checkAdminStatus = (user) => {
    const adminElements = document.querySelectorAll('.admin-only');
    const userEmail = user && user.email ? user.email.toLowerCase().trim() : '';
    const targetAdminEmail = ADMIN_EMAIL ? ADMIN_EMAIL.toLowerCase().trim() : '';
    
    const isAdmin = user && targetAdminEmail && userEmail === targetAdminEmail;

    // Proteção AdSense: Adiciona/Remove classe no body
    if (isAdmin) {
        document.body.classList.add('is-admin');
        // console.log("🔒 Modo Admin Ativo: Anúncios ocultos para prevenir cliques inválidos.");
    } else {
        document.body.classList.remove('is-admin');
    }

    adminElements.forEach(el => {
        if (isAdmin) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });
};

export const initGlobalAuthUI = () => {
    // 1. Setup Auth State UI Changes
    onAuthStateChanged(auth, (user) => {
        // Toggle Admin Elements
        checkAdminStatus(user);

        // Toggle Login/Logout Elements
        const loggedInElements = document.querySelectorAll('.logged-in-only');
        const loggedOutElements = document.querySelectorAll('.logged-out-only');

        loggedInElements.forEach(el => {
            if (user) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });

        loggedOutElements.forEach(el => {
            if (!user) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });

        // Ensure icons are rendered if new elements become visible
        if (window.lucide) {
            setTimeout(() => window.lucide.createIcons(), 0);
        }
    });

    // 2. Setup Interaction Listeners (Auto-bind buttons)
    const setupListeners = () => {
        // Login Buttons
        const loginSelectors = ['#nav-login-btn', '#map-login-btn', '#login-btn', '#banner-login-btn'];
        document.querySelectorAll(loginSelectors.join(',')).forEach(btn => {
            if(btn.dataset.authListenerAttached) return;
            btn.dataset.authListenerAttached = 'true';
            
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleLoginModal(true);
            });
        });

        // Logout Buttons
        const logoutSelectors = ['#nav-logout-btn', '#map-logout-btn', '#logout-btn'];
        document.querySelectorAll(logoutSelectors.join(',')).forEach(btn => {
            if(btn.dataset.authListenerAttached) return;
            btn.dataset.authListenerAttached = 'true';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                signOut(auth).then(() => {
                    // console.log('User signed out');
                }).catch((error) => {
                    console.error('Sign out error', error);
                });
            });
        });

        // Profile Links (Intercept)
        document.querySelectorAll('a[href="/perfil"]').forEach(link => {
            if(link.dataset.authListenerAttached) return;
            link.dataset.authListenerAttached = 'true';

            link.addEventListener('click', (e) => {
                if (!auth.currentUser) {
                    e.preventDefault();
                    toggleLoginModal(true);
                }
            });
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupListeners);
    } else {
        setupListeners();
    }
};

// The HTML content of the modal
const MODAL_HTML = `
<div id="login-modal" class="fixed inset-0 z-[100] hidden" aria-labelledby="modal-title" role="dialog" aria-modal="true">
  <div class="fixed inset-0 bg-gray-500/75 dark:bg-gray-900/80 transition-opacity backdrop-blur-sm" id="modal-backdrop"></div>
  <div class="fixed inset-0 z-10 w-screen overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
      <div class="relative transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-md border border-gray-100 dark:border-gray-700">
        <button id="close-modal-btn" class="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition-colors z-20 text-gray-400">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        
        <div class="px-6 py-8 sm:px-8">
          <div class="text-center">
            <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 mb-6">
              <i data-lucide="user-circle-2" class="h-8 w-8 text-indigo-600 dark:text-indigo-400"></i>
            </div>
            
            <h3 class="text-2xl font-bold leading-tight text-gray-900 dark:text-white mb-2" id="modal-title">Bem-vindo!</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-8 max-w-xs mx-auto" id="modal-desc">
              Faça login para salvar câmeras favoritas e personalizar sua experiência.
            </p>

            <!-- Google Login -->
            <button id="google-login-btn" class="w-full flex items-center justify-center gap-3 bg-white dark:bg-gray-700 text-gray-700 dark:text-white border border-gray-300 dark:border-gray-600 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-all shadow-sm mb-6 group">
              <svg class="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span class="group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Continuar com Google</span>
            </button>
            
            <div class="relative flex items-center py-2 mb-6">
                <div class="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                <span class="flex-shrink-0 mx-4 text-gray-400 text-xs font-medium uppercase tracking-wider">Ou continue com email</span>
                <div class="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
            </div>

            <form id="login-form" class="space-y-4 text-left">
              
              <!-- Nickname (Only for Register) -->
              <div id="nickname-field" class="hidden">
                <label for="nickname" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Apelido (Nickname)</label>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i data-lucide="user" class="h-5 w-5 text-gray-400"></i>
                  </div>
                  <input type="text" name="nickname" id="nickname" 
                    class="block w-full pl-10 pr-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl leading-5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                    placeholder="Como quer ser chamado?">
                </div>
              </div>

              <div>
                <label for="email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i data-lucide="mail" class="h-5 w-5 text-gray-400"></i>
                  </div>
                  <input type="email" name="email" id="email" required
                    class="block w-full pl-10 pr-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl leading-5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                    placeholder="seu@email.com">
                </div>
              </div>

              <div>
                <label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha</label>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i data-lucide="lock" class="h-5 w-5 text-gray-400"></i>
                  </div>
                  <input type="password" name="password" id="password" required
                    class="block w-full pl-10 pr-10 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl leading-5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                    placeholder="Sua senha">
                  <button type="button" id="toggle-password" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer focus:outline-none" tabindex="-1">
                    <i data-lucide="eye" class="h-5 w-5 block"></i>
                    <i data-lucide="eye-off" class="h-5 w-5 hidden"></i>
                  </button>
                </div>
              </div>

              <!-- Confirm Password (Only for Register) -->
              <div id="confirm-password-field" class="hidden">
                <label for="confirm-password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirmar Senha</label>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i data-lucide="lock-keyhole" class="h-5 w-5 text-gray-400"></i>
                  </div>
                  <input type="password" name="confirm-password" id="confirm-password" 
                    class="block w-full pl-10 pr-10 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl leading-5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                    placeholder="Digite a senha novamente">
                  <button type="button" id="toggle-confirm-password" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer focus:outline-none" tabindex="-1">
                    <i data-lucide="eye" class="h-5 w-5 block"></i>
                    <i data-lucide="eye-off" class="h-5 w-5 hidden"></i>
                  </button>
                </div>
              </div>

              <!-- Terms Checkbox (Only for Register) -->
              <div id="terms-field" class="hidden flex items-start">
                <div class="flex items-center h-5">
                  <input id="terms" name="terms" type="checkbox" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700">
                </div>
                <div class="ml-3 text-sm">
                  <label for="terms" class="font-medium text-gray-700 dark:text-gray-300">Eu concordo com os <a href="/termos.html" target="_blank" class="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">Termos de Uso</a> e Política de Privacidade.</label>
                </div>
              </div>

              <div id="login-error" class="hidden text-red-500 text-xs text-left bg-red-50 dark:bg-red-900/20 p-3 rounded-lg flex items-center gap-2">
                <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i>
                <span id="login-error-msg"></span>
              </div>

              <button type="submit" id="submit-btn"
                class="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all transform hover:scale-[1.02] active:scale-[0.98]">
                Entrar
              </button>
            </form>
            
            <div class="mt-6 text-sm">
                <button id="toggle-auth-mode" class="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 font-semibold focus:outline-none hover:underline transition-all">
                    Não tem conta? Cadastre-se
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

let isLoginMode = true;

export function toggleLoginModal(show) {
    const loginModal = document.getElementById('login-modal');
    if (!loginModal) return;
    
    if (show) {
        // Reset to login mode when opening
        setAuthMode(true);
        loginModal.classList.remove('hidden');
        setTimeout(() => {
            const container = loginModal.querySelector('.transform');
            if(container) {
                container.classList.add('transition-all', 'duration-300');
                container.classList.remove('opacity-0', 'scale-95');
                container.classList.add('opacity-100', 'scale-100');
            }
        }, 10);
    } else {
        const container = loginModal.querySelector('.transform');
        if(container) {
            container.classList.remove('opacity-100', 'scale-100');
            container.classList.add('opacity-0', 'scale-95');
        }
        setTimeout(() => {
            loginModal.classList.add('hidden');
            // Clear errors and inputs when closing
            const form = document.getElementById('login-form');
            if (form) form.reset();
            const errorDiv = document.getElementById('login-error');
            if (errorDiv) errorDiv.classList.add('hidden');
        }, 300);
    }
}

function setAuthMode(isLogin) {
    isLoginMode = isLogin;
    const title = document.getElementById('modal-title');
    const desc = document.getElementById('modal-desc');
    const submitBtn = document.getElementById('submit-btn');
    const toggleBtn = document.getElementById('toggle-auth-mode');
    const errorDiv = document.getElementById('login-error');
    
    // Fields to toggle
    const nicknameField = document.getElementById('nickname-field');
    const confirmPasswordField = document.getElementById('confirm-password-field');
    const termsField = document.getElementById('terms-field');
    const nicknameInput = document.getElementById('nickname');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const termsInput = document.getElementById('terms');

    if (errorDiv) errorDiv.classList.add('hidden');

    if (isLogin) {
        // LOGIN MODE
        if (title) title.textContent = "Bem-vindo de volta!";
        if (desc) desc.textContent = "Faça login para salvar câmeras favoritas e personalizar sua experiência.";
        if (submitBtn) submitBtn.textContent = "Entrar";
        if (toggleBtn) toggleBtn.textContent = "Não tem conta? Cadastre-se";
        
        // Hide extra fields
        if (nicknameField) nicknameField.classList.add('hidden');
        if (confirmPasswordField) confirmPasswordField.classList.add('hidden');
        if (termsField) termsField.classList.add('hidden');
        
        // Remove required
        if (nicknameInput) nicknameInput.removeAttribute('required');
        if (confirmPasswordInput) confirmPasswordInput.removeAttribute('required');
        if (termsInput) termsInput.removeAttribute('required');

    } else {
        // REGISTER MODE
        if (title) title.textContent = "Crie sua conta";
        if (desc) desc.textContent = "Preencha os dados abaixo para se cadastrar.";
        if (submitBtn) submitBtn.textContent = "Cadastrar";
        if (toggleBtn) toggleBtn.textContent = "Já tem conta? Entre";

        // Show extra fields
        if (nicknameField) nicknameField.classList.remove('hidden');
        if (confirmPasswordField) confirmPasswordField.classList.remove('hidden');
        if (termsField) termsField.classList.remove('hidden');

        // Add required
        if (nicknameInput) nicknameInput.setAttribute('required', 'true');
        if (confirmPasswordInput) confirmPasswordInput.setAttribute('required', 'true');
        if (termsInput) termsInput.setAttribute('required', 'true');
    }
}

export function initAuthModal() {
    // Inject Modal HTML if not present
    if (!document.getElementById('login-modal')) {
        document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
        if (window.lucide) window.lucide.createIcons();
    }

    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const loginForm = document.getElementById('login-form');
    const toggleBtn = document.getElementById('toggle-auth-mode');

    if (closeModalBtn) closeModalBtn.addEventListener('click', () => toggleLoginModal(false));
    if (modalBackdrop) modalBackdrop.addEventListener('click', () => toggleLoginModal(false));

    // Password Toggle Logic
    const setupPasswordToggle = (btnId, inputId) => {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if(btn && input) {
             btn.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent focus loss if possible, though type=button handles it mostly
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                
                // Toggle icons
                // Note: Lucide replaces <i> with <svg>, so we target the svg children if present, or the original structure if not replaced yet.
                // But since createIcons runs on init, they should be SVGs.
                // However, since we might re-inject HTML, we need to be robust.
                
                // Simple class toggle on children
                Array.from(btn.children).forEach(child => {
                    if (child.classList.contains('block')) {
                        child.classList.remove('block');
                        child.classList.add('hidden');
                    } else {
                        child.classList.remove('hidden');
                        child.classList.add('block');
                    }
                });
            });
        }
    }

    setupPasswordToggle('toggle-password', 'password');
    setupPasswordToggle('toggle-confirm-password', 'confirm-password');

    if (toggleBtn) toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        setAuthMode(!isLoginMode);
    });

    if (googleLoginBtn) googleLoginBtn.addEventListener('click', async () => {
        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            
            // If new user via Google, create Firestore doc
            // We check if it's a new user by checking creation time or just setDoc with merge
            const user = result.user;
            const userRef = doc(db, 'userData', user.uid);
            await setDoc(userRef, {
                email: user.email,
                lastLoginAt: serverTimestamp(),
                // Only set these if they don't exist
            }, { merge: true });

            toggleLoginModal(false);
            // Optional: reload or update UI
        } catch (error) {
            console.error("Google Login Error:", error);
            showLoginError("Erro ao entrar com Google. Tente novamente.");
        }
    });

    if (loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submit-btn');
        const originalBtnText = submitBtn ? submitBtn.textContent : 'Entrar';
        
        // Set Loading State
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processando...
            `;
        }

        const email = loginForm.email.value;
        const password = loginForm.password.value;
        
        try {
            if (isLoginMode) {
                // LOGIN
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                // REGISTRATION
                const nickname = document.getElementById('nickname').value.trim();
                const confirmPassword = document.getElementById('confirm-password').value;
                const terms = document.getElementById('terms').checked;

                if (!terms) {
                    showLoginError("Você deve aceitar os Termos de Uso.");
                    return;
                }

                if (password !== confirmPassword) {
                    showLoginError("As senhas não coincidem.");
                    return;
                }

                if (nickname.length < 3) {
                    showLoginError("O apelido deve ter pelo menos 3 caracteres.");
                    return;
                }

                // Create Auth User
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Update Profile
                await updateProfile(user, {
                    displayName: nickname
                });

                // Create Firestore Document
                await setDoc(doc(db, 'userData', user.uid), {
                    email: email,
                    nickname: nickname, // Save nickname in Firestore too for easy access
                    createdAt: serverTimestamp(),
                    favoriteCameras: []
                });
            }
            
            toggleLoginModal(false);
            loginForm.reset();
        } catch (error) {
            console.error("Auth Error:", error);
            let msg = isLoginMode ? "Erro ao fazer login." : "Erro ao criar conta.";
            
            if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                msg = "Email ou senha incorretos.";
            } else if (error.code === 'auth/too-many-requests') {
                msg = "Muitas tentativas. Tente mais tarde.";
            } else if (error.code === 'auth/email-already-in-use') {
                msg = "Este email já está em uso.";
            } else if (error.code === 'auth/weak-password') {
                msg = "A senha deve ter pelo menos 6 caracteres.";
            } else if (error.code === 'auth/invalid-email') {
                msg = "Email inválido.";
            }
            showLoginError(msg);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                // We don't restore text immediately if successful because modal closes, 
                // but if we want to be safe for re-opening or error cases:
                
                // If it was successful, modal closes and resets anyway via toggleLoginModal logic (which might need to reset text too)
                // But setAuthMode is called on open, which sets the correct text.
                // So here we can just set it back to what it should be based on mode.
                submitBtn.textContent = isLoginMode ? "Entrar" : "Cadastrar";
            }
        }
    });
}

function showLoginError(msg) {
    const errorDiv = document.getElementById('login-error');
    const errorMsg = document.getElementById('login-error-msg');
    if (errorDiv && errorMsg) {
        errorMsg.textContent = msg;
        errorDiv.classList.remove('hidden');
    }
}

export async function logoutUser() {
    try {
        await signOut(auth);
        window.location.reload();
    } catch (error) {
        console.error("Logout Error:", error);
    }
}
