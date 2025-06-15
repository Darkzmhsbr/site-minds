const API = {
    groups: [],
    categories: {
        universitarias: { name: "👯‍♀️ Universitárias", count: 0 },
        cornos: { name: "🤘 Cornos", count: 0 },
        amadoras: { name: "🎥 Amadoras", count: 0 },
        famosas: { name: "⭐ Famosas", count: 0 },
        vazadas: { name: "📱 Vazadas", count: 0 }
    },
    states: {
        SP: "São Paulo",
        RJ: "Rio de Janeiro",
        MG: "Minas Gerais",
        SC: "Santa Catarina",
        RS: "Rio Grande do Sul",
        PR: "Paraná",
        BA: "Bahia",
        PE: "Pernambuco",
        CE: "Ceará",
        GO: "Goiás",
        DF: "Distrito Federal",
        ES: "Espírito Santo"
    }
};

const State = {
    filters: {
        category: [],
        state: [],
        sort: 'views'
    },
    currentGroup: null,
    loading: false,
    page: 1,
    perPage: 12
};

const DOM = {
    get filtersSidebar() { return document.getElementById('filtersSidebar'); },
    get categoriesContainer() { return document.getElementById('categoriesContainer'); },
    get groupModal() { return document.getElementById('groupModal'); },
    get modalGroupName() { return document.getElementById('modalGroupName'); },
    get loadMoreBtn() { return document.getElementById('loadMoreBtn'); }
};

const Utils = {
    setCookie(name, value, hours) {
        const d = new Date();
        d.setTime(d.getTime() + (hours * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
    },
    
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    },
    
    formatNumber(num) {
        return num.toLocaleString('pt-BR');
    },
    
    shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
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

const Groups = {
    async load() {
        try {
            const response = await fetch('/data/grupos.json');
            if (!response.ok) {
                this.generateMockData();
                return;
            }
            API.groups = await response.json();
            window.gruposData = API.groups;
        } catch {
            this.generateMockData();
        }
        this.updateCounts();
    },
    
    generateMockData() {
        const cities = {
            SP: ["São Paulo", "Campinas", "Santos", "Guarulhos"],
            RJ: ["Rio de Janeiro", "Niterói", "Petrópolis"],
            MG: ["Belo Horizonte", "Uberlândia", "Juiz de Fora"],
            SC: ["Florianópolis", "Joinville", "Blumenau"],
            RS: ["Porto Alegre", "Caxias do Sul", "Pelotas"],
            PR: ["Curitiba", "Londrina", "Maringá"],
            BA: ["Salvador", "Feira de Santana", "Vitória da Conquista"],
            PE: ["Recife", "Olinda", "Caruaru"],
            CE: ["Fortaleza", "Caucaia", "Juazeiro do Norte"],
            GO: ["Goiânia", "Aparecida de Goiânia", "Anápolis"],
            DF: ["Brasília", "Taguatinga", "Ceilândia"],
            ES: ["Vitória", "Vila Velha", "Serra"]
        };
        
        const templates = [
            "Flagras de {city} 🔥",
            "{category} {state} Premium",
            "Vazados {city} 18+",
            "Grupo Secreto {city}",
            "{category} Real {state}"
        ];
        
        API.groups = [];
        let id = 1;
        
        Object.keys(API.categories).forEach(category => {
            Object.keys(cities).forEach(state => {
                cities[state].forEach(city => {
                    if (Math.random() > 0.3) {
                        const template = templates[Math.floor(Math.random() * templates.length)];
                        const name = template
                            .replace('{city}', city)
                            .replace('{state}', state)
                            .replace('{category}', API.categories[category].name.split(' ')[1]);
                        
                        API.groups.push({
                            id: id++,
                            name,
                            category,
                            state,
                            city,
                            views: Math.floor(Math.random() * 8000) + 500,
                            image: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect fill='%23${Math.random() > 0.5 ? 'dc2626' : '991b1b'}' width='280' height='160'/%3E%3Ctext x='140' y='80' text-anchor='middle' fill='white' font-size='20'%3E🔞%3C/text%3E%3C/svg%3E`,
                            link: `https://t.me/exemplo${id}`,
                            isNew: Math.random() > 0.8,
                            isPremium: Math.random() > 0.7
                        });
                    }
                });
            });
        });
        
        window.gruposData = API.groups;
    },
    
    updateCounts() {
        Object.keys(API.categories).forEach(cat => {
            API.categories[cat].count = API.groups.filter(g => g.category === cat).length;
        });
    },
    
    filter() {
        let filtered = [...API.groups];
        
        if (State.filters.category.length) {
            filtered = filtered.filter(g => State.filters.category.includes(g.category));
        }
        
        if (State.filters.state.length) {
            filtered = filtered.filter(g => State.filters.state.includes(g.state));
        }
        
        switch (State.filters.sort) {
            case 'views':
                filtered.sort((a, b) => b.views - a.views);
                break;
            case 'new':
                filtered.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
                break;
            case 'hot':
                filtered = Utils.shuffle(filtered);
                break;
        }
        
        return filtered;
    },
    
    paginate(groups) {
        const start = 0;
        const end = State.page * State.perPage;
        return groups.slice(start, end);
    }
};

const UI = {
    createCard(group) {
        const card = document.createElement('div');
        card.className = 'card fade-in';
        card.onclick = () => this.showModal(group);
        
        card.innerHTML = `
            <div class="card-image-wrapper">
                <img src="${group.image}" alt="${group.name}" class="card-image" loading="lazy">
                <div class="card-lock">🔒</div>
                ${group.isNew ? '<span class="badge" style="position:absolute;top:10px;right:10px;">NOVO</span>' : ''}
            </div>
            <div class="card-content">
                <h3 class="card-title">${group.name}</h3>
                <div class="card-meta">
                    <span class="card-location">📍 ${group.city}</span>
                    <span class="card-views">👁 ${Utils.formatNumber(group.views)}</span>
                </div>
                <button class="card-cta">Desbloquear 🔥</button>
            </div>
        `;
        
        return card;
    },
    
    renderGroups() {
        const container = DOM.categoriesContainer;
        if (!container) return;
        
        container.innerHTML = '';
        const filtered = Groups.filter();
        const paginated = Groups.paginate(filtered);
        
        if (State.filters.category.length === 0 && State.filters.state.length === 0) {
            Object.keys(API.categories).forEach(category => {
                const categoryGroups = paginated.filter(g => g.category === category);
                if (categoryGroups.length > 0) {
                    const section = document.createElement('div');
                    section.className = 'category-section';
                    section.innerHTML = `
                        <div class="category-header">
                            <h2 class="category-title">${API.categories[category].name}</h2>
                            <a href="/pages/categorias/${category}.html" class="see-all">Ver todos →</a>
                        </div>
                        <div class="card-grid" id="grid-${category}"></div>
                    `;
                    container.appendChild(section);
                    
                    const grid = section.querySelector(`#grid-${category}`);
                    categoryGroups.forEach(group => {
                        grid.appendChild(this.createCard(group));
                    });
                }
            });
        } else {
            const grid = document.createElement('div');
            grid.className = 'card-grid';
            paginated.forEach(group => {
                grid.appendChild(this.createCard(group));
            });
            container.appendChild(grid);
        }
        
        this.updateLoadMoreButton(filtered.length > paginated.length);
    },
    
    updateLoadMoreButton(show) {
        if (DOM.loadMoreBtn) {
            DOM.loadMoreBtn.style.display = show ? 'block' : 'none';
        }
    },
    
    showModal(group) {
        State.currentGroup = group;
        DOM.modalGroupName.textContent = group.name;
        DOM.groupModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    },
    
    closeModal() {
        DOM.groupModal.classList.remove('active');
        document.body.style.overflow = '';
        State.currentGroup = null;
    },
    
    accessGroup() {
        if (State.currentGroup) {
            window.open(State.currentGroup.link, '_blank');
            this.trackEvent('group_access', State.currentGroup.id);
            this.closeModal();
        }
    },
    
    toggleFilters() {
        DOM.filtersSidebar.classList.toggle('active');
    },
    
    trackEvent(event, value) {
        if (typeof gtag !== 'undefined') {
            gtag('event', event, { value });
        }
    }
};

const Filters = {
    init() {
        document.querySelectorAll('.filter-option').forEach(option => {
            option.addEventListener('click', this.handleFilterClick.bind(this));
        });
    },
    
    handleFilterClick(e) {
        const option = e.currentTarget;
        option.classList.toggle('active');
        
        if (option.dataset.category) {
            this.updateArrayFilter('category', option.dataset.category);
        } else if (option.dataset.state) {
            this.updateArrayFilter('state', option.dataset.state);
        } else if (option.dataset.sort) {
            document.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('active'));
            option.classList.add('active');
            State.filters.sort = option.dataset.sort;
        }
        
        State.page = 1;
        UI.renderGroups();
    },
    
    updateArrayFilter(type, value) {
        const index = State.filters[type].indexOf(value);
        if (index > -1) {
            State.filters[type].splice(index, 1);
        } else {
            State.filters[type].push(value);
        }
    }
};

const App = {
    async init() {
        if (!Utils.getCookie('ageVerified')) {
            window.location.href = '/';
            return;
        }
        
        await Groups.load();
        UI.renderGroups();
        Filters.init();
        this.bindEvents();
        this.startAutoRotation();
    },
    
    bindEvents() {
        window.toggleFilters = UI.toggleFilters.bind(UI);
        window.closeModal = UI.closeModal.bind(UI);
        window.accessGroup = UI.accessGroup.bind(UI);
        
        DOM.groupModal?.addEventListener('click', (e) => {
            if (e.target === DOM.groupModal) UI.closeModal();
        });
        
        DOM.loadMoreBtn?.addEventListener('click', () => {
            State.page++;
            UI.renderGroups();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') UI.closeModal();
        });
    },
    
    startAutoRotation() {
        setInterval(() => {
            API.groups.forEach(group => {
                if (Math.random() > 0.95) {
                    group.views += Math.floor(Math.random() * 10) + 1;
                }
            });
        }, 30000);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());