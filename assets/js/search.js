document.addEventListener('DOMContentLoaded', function() {
    const searchHTML = `
        <div class="search-container">
            <input type="text" id="searchInput" placeholder="Buscar grupos..." autocomplete="off">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
            </svg>
        </div>
        <div id="searchResults" class="search-results"></div>
    `;
    
    const style = document.createElement('style');
    style.textContent = `
        .search-container {
            position: relative;
            flex: 1;
            max-width: 400px;
            margin: 0 2rem;
        }
        
        #searchInput {
            width: 100%;
            padding: 0.5rem 2.5rem 0.5rem 1rem;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 25px;
            color: white;
            font-size: 14px;
            transition: all 0.3s ease;
        }
        
        #searchInput:focus {
            outline: none;
            background: rgba(255, 255, 255, 0.15);
            border-color: #e50914;
        }
        
        #searchInput::placeholder {
            color: rgba(255, 255, 255, 0.4);
        }
        
        .search-icon {
            position: absolute;
            right: 1rem;
            top: 50%;
            transform: translateY(-50%);
            width: 20px;
            height: 20px;
            color: rgba(255, 255, 255, 0.5);
            pointer-events: none;
        }
        
        .search-results {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            margin-top: 0.5rem;
            background: #1a1a1a;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
            max-height: 400px;
            overflow-y: auto;
            display: none;
            z-index: 1000;
        }
        
        .search-results.active {
            display: block;
        }
        
        .search-result-item {
            padding: 1rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 1rem;
            transition: background 0.2s ease;
        }
        
        .search-result-item:hover {
            background: rgba(229, 9, 20, 0.2);
        }
        
        .search-result-item:last-child {
            border-bottom: none;
        }
        
        .search-result-image {
            width: 40px;
            height: 40px;
            border-radius: 4px;
            object-fit: cover;
        }
        
        .search-result-info {
            flex: 1;
        }
        
        .search-result-name {
            font-weight: 600;
            color: white;
            font-size: 14px;
        }
        
        .search-result-meta {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.6);
            margin-top: 2px;
        }
        
        .no-results {
            padding: 2rem;
            text-align: center;
            color: #666;
        }
        
        @media (max-width: 768px) {
            .search-container {
                margin: 0 1rem;
                max-width: none;
            }
        }
    `;
    
    document.head.appendChild(style);
    
    const nav = document.querySelector('nav');
    if (nav && !document.getElementById('searchInput')) {
        const searchWrapper = document.createElement('div');
        searchWrapper.innerHTML = searchHTML;
        nav.insertBefore(searchWrapper.firstElementChild, nav.querySelector('.filters-toggle'));
        nav.parentElement.insertBefore(searchWrapper.lastElementChild, nav.nextSibling);
    }
    
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    
    if (!searchInput || !searchResults) return;
    
    let searchTimeout;
    
    searchInput.addEventListener('input', function(e) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performSearch(e.target.value), 300);
    });
    
    function performSearch(query) {
        query = query.trim().toLowerCase();
        
        if (!query || query.length < 2) {
            searchResults.classList.remove('active');
            return;
        }
        
        const groups = window.gruposData || [];
        
        const results = groups.filter(group => {
            const searchText = `${group.name} ${group.category} ${group.state} ${group.city}`.toLowerCase();
            return searchText.includes(query);
        });
        
        if (results.length === 0) {
            searchResults.innerHTML = '<div class="no-results">Nenhum resultado encontrado</div>';
        } else {
            searchResults.innerHTML = results.slice(0, 10).map(group => `
                <div class="search-result-item" data-link="${group.link}">
                    <img class="search-result-image" src="${group.image}" alt="${group.name}" loading="lazy">
                    <div class="search-result-info">
                        <div class="search-result-name">${highlightMatch(group.name, query)}</div>
                        <div class="search-result-meta">${group.category} • ${group.state} • ${group.city}</div>
                    </div>
                </div>
            `).join('');
        }
        
        searchResults.classList.add('active');
    }
    
    function highlightMatch(text, query) {
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark style="background: #e50914; color: white; padding: 0 2px;">$1</mark>');
    }
    
    searchResults.addEventListener('click', function(e) {
        const item = e.target.closest('.search-result-item');
        if (item && item.dataset.link) {
            window.open(item.dataset.link, '_blank');
        }
    });
    
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-container') && !e.target.closest('.search-results')) {
            searchResults.classList.remove('active');
        }
    });
    
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            searchResults.classList.remove('active');
            searchInput.blur();
        }
    });
})();
