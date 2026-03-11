(function () {
    'use strict';
    
    var Q_LOGGING = true; 
    var Q_CACHE_TIME = 24 * 60 * 60 * 1000; 
    var QUALITY_CACHE = 'maxsm_ratings_quality_cache';
    
    // --- НАСТРОЙКИ ВАШЕГО СЕРВЕРА ---
    var JACRED_IP = '138.124.100.28:9117'; 
    var JACRED_PROTOCOL = 'http://'; 
    // --------------------------------

    var PROXY_TIMEOUT = 8000; 
    var ALLORIGINS_PROXY = 'https://api.allorigins.win/raw?url=';

    var style = "<style id=\"maxsm_ratings_quality\">" +
        ".card__view {position: relative !important;}" +
        ".card__quality { " +
        "   position: absolute !important; " +
        "   bottom: 0.5em !important; " +
        "   left: -0.5em !important; " + // Немного поправил отступ
        "   z-index: 10; " +
        "}" +
        ".card__quality div { " +
        "   text-transform: none !important; " +
        "   border: 1px solid #FFFFFF !important; " +
        "   background-color: rgba(0, 0, 0, 0.8) !important; " + 
        "   color: #FFFFFF !important; " + 
        "   font-weight: bold !important; " + 
        "   font-size: 1.1em !important; " +
        "   border-radius: 4px !important; " +
        "   padding: 0.1em 0.4em !important; " +
        "}" +
        "</style>";

    Lampa.Template.add('maxsm_ratings_quality_css', style);
    $('body').append(Lampa.Template.get('maxsm_ratings_quality_css', {}, true));

    function getCardType(card) {
        var type = card.media_type || card.type;
        if (type === 'movie' || type === 'tv') return type;
        return (card.name || card.original_name) ? 'tv' : 'movie';
    }

    // Улучшенная функция запроса
    function fetchWithProxy(url, cardId, callback) {
        var controller = new AbortController();
        var timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT);

        if (Q_LOGGING) console.log("MAXSM-RATINGS", "Requesting: " + url);

        // Пытаемся сначала напрямую (работает в приложении на Android/ТВ)
        fetch(url, { signal: controller.signal })
            .then(res => res.text())
            .then(data => {
                clearTimeout(timeoutId);
                callback(null, data);
            })
            .catch(err => {
                if (Q_LOGGING) console.log("MAXSM-RATINGS", "Direct failed, trying AllOrigins proxy...");
                
                // Если напрямую не вышло (CORS в браузере), используем прокси
                var proxyUrl = ALLORIGINS_PROXY + encodeURIComponent(url);
                fetch(proxyUrl)
                    .then(res => res.text())
                    .then(data => callback(null, data))
                    .catch(e => callback(e));
            });
    }

    function getBestReleaseFromJacred(normalizedCard, cardId, callback) {
        var year = (normalizedCard.release_date || '').substring(0, 4);
        if (!year || isNaN(year)) {
            callback(null);
            return;
        }

        var userId = Lampa.Storage.get('lampac_unic_id', '');
        var searchTitle = normalizedCard.original_title || normalizedCard.title;
        
        var apiUrl = JACRED_PROTOCOL + JACRED_IP + '/api/v1.0/torrents?search=' +
                     encodeURIComponent(searchTitle) +
                     '&year=' + year +
                     '&exact=true' +
                     '&uid=' + userId;

        fetchWithProxy(apiUrl, cardId, function(error, responseText) {
            if (error || !responseText) {
                callback(null);
                return;
            }
            try {
                var torrents = JSON.parse(responseText);
                if (!Array.isArray(torrents) || torrents.length === 0) {
                    callback(null);
                    return;
                }

                var bestQ = 0;
                var labels = { 2160: '4K', 1080: 'FHD', 720: 'HD', 480: 'SD' };
                
                torrents.forEach(t => {
                    if (t.quality > bestQ) bestQ = t.quality;
                });

                if (bestQ >= 2160) callback({ quality: '4K' });
                else if (bestQ >= 1080) callback({ quality: 'FHD' });
                else if (bestQ >= 720) callback({ quality: 'HD' });
                else callback(null);

            } catch (e) {
                callback(null);
            }
        });
    }

    function getQualityCache(key) {
        var cache = Lampa.Storage.get(QUALITY_CACHE) || {};
        var item = cache[key];
        return item && (Date.now() - item.timestamp < Q_CACHE_TIME) ? item : null;
    }

    function saveQualityCache(key, quality) {
        var cache = Lampa.Storage.get(QUALITY_CACHE) || {};
        cache[key] = { quality: quality, timestamp: Date.now() };
        Lampa.Storage.set(QUALITY_CACHE, cache);
    }

    function applyQualityToCard(card, quality, qCacheKey) {
        if (!document.body.contains(card)) return;
        card.setAttribute('data-quality-added', 'true');
        
        var cardView = card.querySelector('.card__view');
        if (!cardView || !quality) return;

        $(cardView).find('.card__quality').remove();

        var qualityDiv = $('<div class="card__quality"><div>' + quality + '</div></div>');
        $(cardView).append(qualityDiv);
        
        if (qCacheKey) saveQualityCache(qCacheKey, quality);
    }

    function updateCards(cards) {
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            if (card.hasAttribute('data-quality-added')) continue;

            (function (currentCard) {
                var data = currentCard.card_data;
                if (!data) return;

                var normalized = {
                    id: data.id,
                    title: data.title || data.name,
                    original_title: data.original_title || data.original_name,
                    release_date: data.release_date || data.first_air_date,
                    type: getCardType(data)
                };

                var qCacheKey = normalized.type + '_' + normalized.id;
                var cache = getQualityCache(qCacheKey);

                if (cache) {
                    applyQualityToCard(currentCard, cache.quality);
                } else {
                    getBestReleaseFromJacred(normalized, normalized.id, function (res) {
                        if (res) applyQualityToCard(currentCard, res.quality, qCacheKey);
                    });
                }
            })(card);
        }
    }

    var observer = new MutationObserver(function (mutations) {
        var newCards = [];
        mutations.forEach(m => {
            if (m.addedNodes) {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        if (node.classList.contains('card')) newCards.push(node);
                        var nested = node.querySelectorAll('.card');
                        nested.forEach(c => newCards.push(c));
                    }
                });
            }
        });
        if (newCards.length) updateCards(newCards);
    });

    function startPlugin() {
        console.log("MAXSM-RATINGS-QUALITY", "Plugin started with IP: " + JACRED_IP);
        observer.observe(document.body, { childList: true, subtree: true });
        var existing = document.querySelectorAll('.card');
        if (existing.length) updateCards(existing);
    }

    if (!window.maxsmRatingsQualityPlugin) {
        window.maxsmRatingsQualityPlugin = true;
        startPlugin();
    }
})();
