const CardSystem = {
    template: {
        card: (group) => `
            <div class="card fade-in" data-id="${group.id}" data-category="${group.category}" data-state="${group.state}">
                <div class="card-image-wrapper">
                    <img src="${group.image}" alt="${group.name}" class="card-image" loading="lazy">
                    <div class="card-lock">🔒</div>
                    ${group.isNew ? '<span class="badge new">NOVO</span>' : ''}
                    ${group.isPremium ? '<span class="badge premium">VIP</span>' : ''}
                    ${group.views > 5000 ? '<span class="badge hot">🔥</span>' : ''}
                </div>
                <div class="card-content">
                    <h3 class="card-title">${group.name}</h3>
                    <div class="card-meta">
                        <span class="card-location">📍 ${group.city}</span>
                        <span class="card-views">👁 ${this.formatViews(group.views)}</span>
                    </div>
                    <button class="card-cta" onclick="CardSystem.handleClick(${group.id})">
                        Desbloquear 🔥
                    </button>
                </div>
            </div>
        `,

        skeleton: () => `
            <div class="card skeleton">
                <div class="card-image-wrapper loading-skeleton" style="height: 160px;"></div>
                <div class="card-content">
                    <div class="loading-skeleton" style="height: 20px; margin-bottom: 8px;"></div>
                    <div class="loading-skeleton" style="height: 16px; width: 70%;"></div>
                </div>
            </div>
        `
    },

    handleClick(groupId) {
        const group = window.gruposData.find(g => g.id === groupId);
        if (group) {
            GroupModal.show(group);
            Analytics.track('card_click', { groupId, category: group.category });
        }
    },

    formatViews(views) {
        if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
        if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
        return views.toString();
    },

    render(groups, container) {
        if (!container) return;
        
        container.innerHTML = groups.map(group => this.template.card(group)).join('');
        this.lazyLoadImages();
    },

    renderSkeletons(count, container) {
        if (!container) return;
        
        container.innerHTML = Array(count).fill(0).map(() => this.template.skeleton()).join('');
    },

    lazyLoadImages() {
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src || img.src;
                        img.classList.add('loaded');
                        observer.unobserve(img);
                    }
                });
            });

            document.querySelectorAll('.card-image').forEach(img => imageObserver.observe(img));
        }
    },

    updateViewCount(groupId, increment = 1) {
        const card = document.querySelector(`[data-id="${groupId}"]`);
        if (card) {
            const viewsEl = card.querySelector('.card-views');
            const group = window.gruposData.find(g => g.id === groupId);
            if (group && viewsEl) {
                group.views += increment;
                viewsEl.innerHTML = `👁 ${this.formatViews(group.views)}`;
            }
        }
    },

    animateIn(container) {
        const cards = container.querySelectorAll('.card');
        cards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            setTimeout(() => {
                card.style.transition = 'all 0.3s ease-out';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, index * 50);
        });
    }
};

const GroupModal = {
    current: null,

    show(group) {
        this.current = group;
        const modal = document.getElementById('groupModal');
        if (!modal) return;

        document.getElementById('modalGroupName').textContent = group.name;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        CardSystem.updateViewCount(group.id);
    },

    hide() {
        const modal = document.getElementById('groupModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        this.current = null;
    },

    access() {
        if (this.current) {
            window.open(this.current.link, '_blank');
            Analytics.track('group_access', { 
                groupId: this.current.id,
                category: this.current.category,
                isPremium: this.current.isPremium
            });
            this.hide();
        }
    }
};

window.closeModal = () => GroupModal.hide();
window.accessGroup = () => GroupModal.access();