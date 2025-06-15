const AgeVerification = {
    cookieName: 'ageVerified',
    cookieDuration: 24,
    redirectDelay: 2000,
    countdownDuration: 7,

    init() {
        if (this.isVerified()) {
            this.redirectToHome();
            return;
        }
        this.setupEventListeners();
    },

    setupEventListeners() {
        const yesBtn = document.getElementById('ageYes');
        const noBtn = document.getElementById('ageNo');
        
        if (yesBtn) yesBtn.addEventListener('click', () => this.handleVerification(true));
        if (noBtn) noBtn.addEventListener('click', () => this.handleVerification(false));
    },

    handleVerification(isAdult) {
        if (!isAdult) {
            this.showError();
            setTimeout(() => window.location.href = 'https://www.google.com', this.redirectDelay);
            return;
        }
        
        this.startVerificationProcess();
    },

    startVerificationProcess() {
        const verifySection = document.getElementById('ageVerification');
        const loadingSection = document.getElementById('loadingContainer');
        
        if (verifySection) verifySection.style.display = 'none';
        if (loadingSection) loadingSection.style.display = 'flex';
        
        this.startCountdown();
    },

    startCountdown() {
        let count = this.countdownDuration;
        const counterEl = document.getElementById('counter');
        const messages = [
            'Verificando sua idade...',
            'Carregando grupos exclusivos...',
            'Preparando conteúdo premium...',
            'Desbloqueando acesso...',
            'Conectando ao servidor...',
            'Quase lá...'
        ];
        
        let messageIndex = 0;
        const messageEl = document.getElementById('loadingMessage');
        
        const messageInterval = setInterval(() => {
            if (messageIndex < messages.length && messageEl) {
                messageEl.textContent = messages[messageIndex];
                messageIndex++;
            }
        }, 1000);
        
        const countdownInterval = setInterval(() => {
            count--;
            if (counterEl) counterEl.textContent = count;
            
            if (count <= 0) {
                clearInterval(countdownInterval);
                clearInterval(messageInterval);
                this.setCookie();
                this.redirectToHome();
            }
        }, 1000);
    },

    showError() {
        const errorEl = document.getElementById('errorMessage');
        if (errorEl) errorEl.style.display = 'block';
    },

    setCookie() {
        const date = new Date();
        date.setTime(date.getTime() + (this.cookieDuration * 60 * 60 * 1000));
        document.cookie = `${this.cookieName}=true;expires=${date.toUTCString()};path=/;SameSite=Strict`;
    },

    getCookie() {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${this.cookieName}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    },

    isVerified() {
        return this.getCookie() === 'true';
    },

    redirectToHome() {
        window.location.href = '/pages/home.html';
    },

    reset() {
        document.cookie = `${this.cookieName}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AgeVerification.init());
} else {
    AgeVerification.init();
}