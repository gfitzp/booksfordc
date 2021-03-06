//////////////////////
/* GLOBAL VARIABLES */
//////////////////////


var debug = true;
var LOG = debug ? console.log.bind(console) : function () {};

var preferences;
var reference;
var resource;
var innerLayout;


///////////////
/* LISTENERS */
///////////////


function optionsListener() {
    $('.bfdc-options').click(function() {
        LOG('options: handling click');
        chrome.runtime.sendMessage({'options': true});
    });
}


///////////////
/* UTILITIES */
///////////////


function cleanTitle (title) {
    title = title.replace(/\(.*\)/g, '')
                            .replace(/\[.*\]/, '')
                            .replace(/^\s*(.*?)\s*$/, '$1');
    LOG('initialize: title cleaning');
    return title;
}


// remove subtitles (after colon)
function overdriveTitle (title) {
    LOG('initialize: additional title cleaning');
    return title.replace(/:.*/, '');
}


function cleanAuthor (author) {
    LOG('initialize: author cleaning');
    return author.replace('Ph.D.', '')
                 .replace(/ +$/, '');
}


// remove initials in names
function overdriveAuthor (author) {
    LOG('initialize: additional author cleaning');
    return author.replace(/([A-Z]\.)+/g, '');
}


// convert isbn-10 to isbn-13 for Sirsi
function convertISBN (isbn10) {
    LOG('initialize: converting isbn-10 to isbn-13');
    var isbn = '978' + isbn10.substring(0, isbn10.length - 1);
    isbn = isbn + checkDigit(isbn);
    return isbn;
}


function checkDigit (isbn) {
    LOG('initialize: determining isbn check digit');
    var sum = 0;
    for (var i = 1; i < isbn.length + 1; i++) {
        if (i % 2 === 0) {
            sum += parseInt(isbn.charAt(i - 1)) * 3;
        } else {
            sum += parseInt(isbn.charAt(i - 1));
        }
    }
    var check = (10 - sum % 10) % 10;
    return check.toString();
}


// Python-ish string formatting
String.prototype.format = function() {
    var num = arguments.length;
    var str = this;
    var matches = str.match(/{}/g);
    if( matches.length !== num ) {
        throw RangeError;
    }
    for (var i = 0; i < num; i++ ) {
        str = str.replace(/{}/, arguments[i] );
    }
    return str;
};


////////////
/* LAYOUT */
////////////


// create divs for media types
function finishLayout (preferences) {
    var mediaDiv = "<div class='bfdc-media-title bfdc-media'> {}s </div> <div id='bfdc-{}' class='bfdc-media bfdc-media-status'> searching <img src = '" + chrome.extension.getURL('assets/ajax-loader.gif') + "'> </div>";
    var preferencesSet = false;

    ['audiobook', 'ebook', 'book'].forEach(function(media) {
        if (preferences[media]) {
            LOG('initialize: making div for ' + media + ' results');
            preferencesSet = true;
            $('.bfdc-title:eq(0)').after(mediaDiv.format(media, media));
        }
    })

    if (!preferencesSet) {
        LOG('initialize: no media type chosen');
        $('.bfdc-title:eq(0)').after("<div class='bfdc-media'> <a class='bfdc-options'> click here to set your search preferences </a>");
    } else {
        $('div.bfdc-media:last-child').after("<div class='bfdc-media bfdc-footer'> <a class='bfdc-options'> options & info </a>");
    }
}


// display success message
function successLayout (media, itemURL) {
    var item = resource[media];
    var target = preferences.openTabs ? '_blank' : '_self';
    var message = "<a class='bfdc-media bfdc-media-results' target='{}' href='{}'>{} located </a> <br>{} ({})";

    var total = (item.total === 1) ? item.total + ' copy' : item.total + ' copies';
    var available = item.available + ' available';

    $('div#bfdc-' + media).html(message.format(target, itemURL, media, total, available));
}


// display failure message
function failureLayout (media, failure_type, failure_url) {
    var target = preferences.openTabs ? '_blank' : '_self';
    var message = "{} <br> <a class='bfdc-media bfdc-media-results' target='{}' href = '{}'>{}</a>";

    if (failure_type === 'not_located') {
        $('div#bfdc-' + media).html(message.format('not found', target, failure_url, 'search manually'));
    } else {
        $('div#bfdc-' + media).html(message.format('possible match found', target, failure_url, 'view results'));
    }
}


//////////////////////
/* SEARCH FUNCTIONS */
//////////////////////


function setUp (site) {
    LOG('initialize: loading preferences')
    chrome.storage.sync.get(['book', 'ebook', 'audiobook', 'openTabs'], function (p) {
        resource = new Resource();

        if ((resource.title && resource.author) || resource.isbn) {
            LOG('initialize: on a book page');
            LOG('author:', resource.author, 'title:', resource.title, 'isbn:', resource.isbn);

            innerLayout = "<div class='bfdc-icon'> \
                             <a class='bfdc-options'> \
                                <img class='bfdc-icon-img' src = '" + chrome.extension.getURL('assets/icon16white.png') + "'> \
                             </a> \
                         </div> \
                         <div class='bfdc-availability'> \
                            <div class='bfdc-title'> \
                                <a href = 'http://booksfordc.org' target='_blank'> booksfordc </a> \
                            </div> \
                         </div>";

            preferences = p;
            reference = new Reference();
            initLayout(site, preferences);
            initSearch(preferences);
        } else {
            LOG('Initialize: Not on resource page');
        }
    });
}


function Resource () {
    this.author = cleanAuthor(getAuthor());
    this.title = cleanTitle(getTitle());
    this.isbn = getISBN();
    this.book = {};
    this.ebook = {};
    this.audiobook = {};
}


function Reference () {
    var base = 'https://catalog.dclibrary.org/client/en_US/dcpl/search/results?ln=en_US&rt=&qu=';
    var oTitle = overdriveTitle(resource.title);
    var oAuthor = overdriveAuthor(resource.author);
    var overdriveURL = 'https://dclibrary.overdrive.com/search/title?query=' + encodeURIComponent(oTitle) + '&creator=' + encodeURIComponent(oAuthor) + '&sortBy=relevance';

    this.book = {
        'search': [
                    base + resource.isbn + '&te=&lm=BOOKS',
                    base + encodeURIComponent(resource.title + ' ' + resource.author).replace(/'/g, '%27') + '&qu=-%22sound+recording%22&te=&lm=BOOKS',
                    base + encodeURIComponent(oTitle + ' ' + resource.author).replace(/'/g, '%27') + '&qu=-%22sound+recording%22&te=&lm=BOOKS'
                  ],
        'fail':   'http://dclibrary.org/'
    };

    this.digital = {
        'search': [overdriveURL]
    };

    this.ebook = {
        'search': [overdriveURL + '&mediaType=ebook'],
        'fail':   'http://overdrive.dclibrary.org'
    };

    this.audiobook = {
        'search': [overdriveURL + '&mediaType=audiobook'],
        'fail':   'http://overdrive.dclibrary.org'
    };
}


function initSearch (preferences) {
    if (preferences.book) {
        if (!resource.isbn) {
            LOG('book: searching catalog by title and author');
            searchCatalog('book', 1);
        } else {
            LOG('book: searching catalog by isbn');
            searchCatalog('book', 0);
        }
    }

    if (preferences.ebook && preferences.audiobook)
        searchCatalog('digital', 0);
    else if (preferences.audiobook)
        searchCatalog('audiobook', 0);
    else if (preferences.ebook)
        searchCatalog('ebook', 0);
}


function searchCatalog (media, url_index) {
    $.get(reference[media].search[url_index], function(data) {
        LOG(media + ':', reference[media].search[url_index]);
        if (media === 'book')
            sirsiAvailability(data, media, url_index);
        if (media === 'digital') {
            overdriveAvailability(data, 'ebook');
            overdriveAvailability(data, 'audiobook');
        } else if (media === 'ebook')
            overdriveAvailability(data, 'ebook');
        else if (media === 'audiobook') {
            overdriveAvailability(data, 'audiobook');
        }
    });
}


// function searchOverdrive (media) {
    // chrome.runtime.sendMessage({
    //     method: 'GET',
    //     action: 'xhttp',
    //     url: reference[media].search[0]
    // }, function(response) {
    //         LOG(reference[media].search[0]);
    //         var result = $(response);
    //         overdriveAvailability(result, media);
    //     }
    // );
// }


function sirsiAvailability (data, media, urlIndex) {

     try {
            if ($(data).find('.copiesCountNumber').length !== 1) {
                throw "bookNotFoundError";
            }

            var _ = $(data).text().replace(/\n/g, '');
            var availability = JSON.parse(_.replace(/.*parseDetailAvailabilityJSON\((.+?)\)\;.*/, '$1'));

            resource.book.available = parseInt(availability.totalAvailable.toString(), 10);
            resource.book.total = parseInt(availability.copies[0].match(/(\d+)$/)[1], 10);

            successLayout('book', reference.book.search[urlIndex]);

            LOG('book: Located in catalog');

    } catch (e) {
        LOG('error:', e);
        if (urlIndex === 0) {
            LOG('book: search by isbn failed\nbook: Searching catalog by title and author');
            searchCatalog(media, 1);
        } else if (urlIndex === 1 && resource.title.match(/:/) !== null) {
            LOG('book: searching catalog without subtitle');
            searchCatalog(media, 2);
        } else if ($(data).find('#no_results_wrapper').length) {
            LOG('book: not located in catalog');
            failureLayout(media, 'not_located', reference[media].search[urlIndex]);
        } else {
            LOG('book: uncertain match in catalog');
            failureLayout(media, 'uncertain', reference[media].search[urlIndex]);
        }
    }
}


function overdriveAvailability (data, media) {
    try {
        var item = $(data).find('.title-container.' + media)[0];
        var availability = $(item).find('.copies-available')[0].innerText;

        resource[media].available = parseInt(availability.match(/(\d+)/g)[0], 10);
        resource[media].total = parseInt(availability.match(/(\d+)/g)[1], 10);

        if (!resource[media].total) {
            throw RangeError;
        }

        var itemHREF = $(item).find('.title-name > a:first-of-type')[0].getAttribute('href');
        var itemURL = 'https://dclibrary.overdrive.com' + itemHREF;

        successLayout(media, itemURL);
        LOG(media + ': located in overdrive');
    } catch (e) {
        LOG(media + ': not located in overdrive');
        failureLayout(media, 'not_located', reference[media].fail);
    }
}
