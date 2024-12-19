(function () {
    'use strict';

    function account(url){
      var email = Lampa.Storage.get('account_email') || Lampa.Storage.get('lampac_unic_id', '')
      if(email) url = Lampa.Utils.addUrlComponent(url,'account_email=' + encodeURIComponent(email))
      return url
    }

    Lampa.TMDB.image = function (url) {
      var base = Lampa.Utils.protocol() + 'image.tmdb.org/' + url;
      return Lampa.Storage.field('proxy_tmdb') ? 'http://45.91.193.139:18092/proxyimg/' + account(base) : base;
    };

    Lampa.TMDB.api = function (url) {
      var base = Lampa.Utils.protocol() + 'api.themoviedb.org/3/' + url;
      return Lampa.Storage.field('proxy_tmdb') ? 'http://45.91.193.139:18092/proxy/' + account(base) : base;
    };

    Lampa.Settings.listener.follow('open', function (e) {
      if (e.name == 'tmdb') {
        e.body.find('[data-parent="proxy"]').remove();
      }
    });

})();
