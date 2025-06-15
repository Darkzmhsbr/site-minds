const Analytics = {
    sessionId: null,
    userId: null,
    
    init() {
        this.sessionId = this.generateId();
        this.userId = this.getUserId();
        this.trackPageView();
        this.setupEventTracking();
    },

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    getUserId() {
        let userId = localStorage.getItem('userId');
        if (!userId) {
            userId = this.generateId();
            localStorage.setItem('userId', userId);
        }
        return userId;
    },

    track(event, data = {}) {
        const payload = {
            event,
            timestamp: Date.now(),
            sessionId: this.sessionId,
            userId: this.userId,
            url: window.location.href,
            referrer: document.referrer,
            ...data
        };

        if (typeof gtag !== 'undefined') {
            gtag('event', event, {
                event_category: data.category || 'engagement',
                event_label: data.label || '',
                value: data.value || 0
            });
        }

        this.sendBeacon(payload);
    },

    trackPageView() {
        this.track('page_view', {
            title: document.title,
            path: window.location.pathname
        });
    },

    trackScroll() {
        let maxScroll = 0;
        const trackScroll = this.throttle(() => {
            const scrollPercent = Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100);
            if (scrollPercent > maxScroll) {
                maxScroll = scrollPercent;
                if (maxScroll % 25 === 0) {
                    this.track('scroll_depth', { depth: maxScroll });
                }
            }
        }, 500);

        window.addEventListener('scroll', trackScroll);
    },

    trackTime() {
        const startTime = Date.now();
        window.addEventListener('beforeunload', () => {
            const timeSpent = Math.round((Date.now() - startTime) / 1000);
            this.track('time_on_page', { seconds: timeSpent });
        });
    },

    setupEventTracking() {
        document.addEventListener('click', e => {
            const button = e.target.closest('button, .btn, [data-track]');
            if (button) {
                const trackData = button.dataset.track ? JSON.parse(button.dataset.track) : {};
                this.track('click', {
                    element: button.className,
                    text: button.textContent.trim(),
                    ...trackData
                });
            }
        });

        this.trackScroll();
        this.trackTime();
    },

    sendBeacon(data) {
        const endpoint = '/api/analytics';
        
        if (navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, JSON.stringify(data));
        } else {
            fetch(endpoint, {
                method: 'POST',
                body: JSON.stringify(data),
                keepalive: true
            }).catch(() => {});
        }
    },

    throttle(func, delay) {
        let lastCall = 0;
        return function(...args) {
            const now = Date.now();
            if (now - lastCall >= delay) {
                lastCall = now;
                return func(...args);
            }
        };
    }
};

document.addEventListener('DOMContentLoaded', () => Analytics.init());