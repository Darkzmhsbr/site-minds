const FilterSystem = {
    state: {
        categories: [],
        states: [],
        sort: 'views',
        search: '',
        priceRange: 'all'
    },

    init() {
        this.bindEvents();
        this.loadFromURL();
    },

    bindEvents() {
        document.addEventListener('click', e => {
            if (e.target.matches('[data-filter]')) {
                this.handleFilter(e.target);
            }
        });

        const searchInput = document.getElementById('searchFilter');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce(e => {
                this.state.search = e.target.value.toLowerCase();
                this.apply();
            }, 300));
        }
    },

    handleFilter(element) {
        const { filter, value } = element.dataset;
        
        switch (filter) {
            case 'category':
                this.toggleArrayItem(this.state.categories, value);
                break;
            case 'state':
                this.toggleArrayItem(this.state.states, value);
                break;
            case 'sort':
                this.state.sort = value;
                document.querySelectorAll('[data-filter="sort"]').forEach(el => {
                    el.classList.toggle('active', el.dataset.value === value);
                });
                break;
            case 'price':
                this.state.priceRange = value;
                break;
        }

        element.classList.toggle('active');
        this.apply();
        this.updateURL();
    },

    toggleArrayItem(array, item) {
        const index = array.indexOf(item);
        if (index > -1) {
            array.splice(index, 1);
        } else {
            array.push(item);
        }
    },

    apply() {
        const groups = this.filterGroups();
        const sorted = this.sortGroups(groups);
        this.render(sorted);
    },

    filterGroups() {
        return window.gruposData.filter(group => {
            if (this.state.categories.length && !this.state.categories.includes(group.category)) {
                return false;
            }
            if (this.state.states.length && !this.state.states.includes(group.state)) {
                return false;
            }
            if (this.state.search && !group.name.toLowerCase().includes(this.state.search)) {
                return false;
            }
            if (this.state.priceRange !== 'all') {
                if (this.state.priceRange === 'free' && group.isPremium) return false;
                if (this.state.priceRange === 'premium' && !group.isPremium) return false;
            }
            return true;
        });
    },

    sortGroups(groups) {
        const sorted = [...groups];
        
        switch (this.state.sort) {
            case 'views':
                return sorted.sort((a, b) => b.views - a.views);
            case 'new':
                return sorted.sort((a, b) => {
                    if (a.isNew && !b.isNew) return -1;
                    if (!a.isNew && b.isNew) return 1;
                    return b.id - a.id;
                });
            case 'hot':
                return sorted.sort((a, b) => {
                    const scoreA = a.views + (a.isNew ? 1000 : 0);
                    const scoreB = b.views + (b.isNew ? 1000 : 0);
                    return scoreB - scoreA;
                });
            case 'alpha':
                return sorted.sort((a, b) => a.name.localeCompare(b.name));
            default:
                return sorted;
        }
    },

    render(groups) {
        const container = document.getElementById('groupsContainer');
        if (!container) return;

        if (groups.length === 0) {
            container.innerHTML = `
                <div class="no-results">
                    <p>Nenhum grupo encontrado com os filtros selecionados.</p>
                    <button class="btn" onclick="FilterSystem.reset()">Limpar filtros</button>
                </div>
            `;
            return;
        }

        container.innerHTML = groups.map(group => `
            <div class="card fade-in" onclick="GroupModal.show(${group.id})">
                <div class="card-image-wrapper">
                    <img src="${group.image}" alt="${group.name}" class="card-image" loading="lazy">
                    <div class="card-lock">🔒</div>
                    ${group.isNew ? '<span class="badge new">NOVO</span>' : ''}
                    ${group.isPremium ? '<span class="badge premium">VIP</span>' : ''}
                </div>
                <div class="card-content">
                    <h3 class="card-title">${group.name}</h3>
                    <div class="card-meta">
                        <span class="card-location">📍 ${group.city}</span>
                        <span class="card-views">👁 ${this.formatNumber(group.views)}</span>
                    </div>
                    <button class="card-cta">Desbloquear 🔥</button>
                </div>
            </div>
        `).join('');

        this.updateCounter(groups.length);
    },

    updateCounter(count) {
        const counter = document.getElementById('resultsCounter');
        if (counter) {
            counter.textContent = `${count} grupos encontrados`;
        }
    },

    updateURL() {
        const params = new URLSearchParams();
        
        if (this.state.categories.length) {
            params.set('cat', this.state.categories.join(','));
        }
        if (this.state.states.length) {
            params.set('state', this.state.states.join(','));
        }
        if (this.state.sort !== 'views') {
            params.set('sort', this.state.sort);
        }
        
        const url = params.toString() ? `?${params.toString()}` : location.pathname;
        history.replaceState(null, '', url);
    },

    loadFromURL() {
        const params = new URLSearchParams(location.search);
        
        if (params.has('cat')) {
            this.state.categories = params.get('cat').split(',');
        }
        if (params.has('state')) {
            this.state.states = params.get('state').split(',');
        }
        if (params.has('sort')) {
            this.state.sort = params.get('sort');
        }

        this.syncUI();
        this.apply();
    },

    syncUI() {
        document.querySelectorAll('[data-filter]').forEach(el => {
            const { filter, value } = el.dataset;
            
            if (filter === 'category' && this.state.categories.includes(value)) {
                el.classList.add('active');
            }
            if (filter === 'state' && this.state.states.includes(value)) {
                el.classList.add('active');
            }
            if (filter === 'sort' && this.state.sort === value) {
                el.classList.add('active');
            }
        });
    },

    reset() {
        this.state = {
            categories: [],
            states: [],
            sort: 'views',
            search: '',
            priceRange: 'all'
        };
        
        document.querySelectorAll('[data-filter].active').forEach(el => {
            el.classList.remove('active');
        });
        
        const searchInput = document.getElementById('searchFilter');
        if (searchInput) searchInput.value = '';
        
        this.apply();
        this.updateURL();
    },

    formatNumber(num) {
        return num.toLocaleString('pt-BR');
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

document.addEventListener('DOMContentLoaded', () => FilterSystem.init());