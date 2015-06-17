(function() {
  "use strict";
  window.TRELLOVIEW = window.TRELLOVIEW || {};
  var $ = window.jQuery;

  function List(listData) {
    this.id = listData.id
    this.name = listData.name
    this.cards = []
  }

  List.prototype.htmlSummary = function() {
    return '<li>' + this.name + ' (<a href="#">' + this.cards.length + ' cards</a>) <a href="#" class="printable" data-listid="' + this.id + '">Print</a></li>'
  }

  List.prototype.htmlCardList = function() {
    var result = '<li>' + this.name + ' <button type="button" class="btn btn-default btn-sm printable" data-listid="' + this.id + '">Print</button><ol>' + $.map(this.cards, function(card) { return card.htmlSummary() }).join('') + '</ol></li>'

    return result
  }

  function Label(labelData) {
    var nameMatches = labelData.name.match("([^:]+): (.*)")

    if (nameMatches) {
      this.name = nameMatches[2]
      this.type = nameMatches[1]
    } else {
      this.name = labelData.name
      this.type = "Type"
    }

    this.id = labelData.id
    this.color = labelData.color
    this.cards = []
  }

  function LabelType(type) {
    this.type = type
    this.labels = []
  }

  LabelType.prototype.push = function(label) {
    this.labels.push(label)
  }

  function Card(cardData, list, allLabels) {
    this.list = list
    this.name = cardData.name
    this.shortUrl = cardData.shortUrl
    this.description = cardData.desc
    this.labels = $.map(cardData.idLabels, function(labelId) {
      var label = allLabels[labelId]
      if (label) {
        label.cards.push(this)
      }
      return label
    })
  }

  Card.prototype.htmlSummary = function() {
    return '<li><a href="' + this.shortUrl + '">' + this.name + '</a><ol>' + this.labels.map(function(i) { return '<li>' + i.name + '</li>' }).join('') + '</ol></li>'
  }

  TRELLOVIEW = {

    init: function(queryParams) {
      var key = queryParams["k"] || '4e6c185d2c22ee0f51332d0a1657eaeb'
      Trello.setKey(key)
      TRELLOVIEW.boardId = queryParams["b"]
      TRELLOVIEW.view = queryParams["v"] || 'lists'

      TRELLOVIEW.loadTemplates()
      TRELLOVIEW.prepareLayout()

      TRELLOVIEW.fetchesInProgress = Object.create(null)
      TRELLOVIEW.buildLists()

      TRELLOVIEW.$display.on("click", ".printable", TRELLOVIEW.printPrintable)
    },

    loadTemplates: function() {
      TRELLOVIEW.templateLeftNavbar = $('#template-left-navbar').html()
      Mustache.parse(TRELLOVIEW.templateLeftNavbar);
    },

    prepareLayout: function() {
      TRELLOVIEW.$display = $("div.js-display")
      TRELLOVIEW.$leftNavbar = $("#left-navbar")
    },

    fetch: function() {
      TRELLOVIEW.fetchMainData()
      TRELLOVIEW.fetchLabels()
      TRELLOVIEW.fetchLists()
      TRELLOVIEW.fetchCards()
    },

    startFetch: function(name) {
      TRELLOVIEW.fetchesInProgress[name] = 1
      TRELLOVIEW.showFetchesInProgress()
    },

    stopFetch: function(name) {
      delete TRELLOVIEW.fetchesInProgress[name]
      TRELLOVIEW.showFetchesInProgress()
    },

    showFetchesInProgress: function() {
      var $elt = $(".fetchesInProgress"),
          names = Object.keys(TRELLOVIEW.fetchesInProgress)
      if (names.length) {
        $elt.text("Fetching " + names.join(", ") + " ...")
        $elt.show()
      } else {
        $elt.hide()
      }
    },

    ajaxError: function(error) {
      var message, $failure = $(".js-failure-box");
      if (error === undefined) {
        $failure.text('')
        $failure.addClass('hidden')
      } else {
        if (error.status === 0) {
          message = "Networking error - unable to talk to Trello"
        } else {
          message = "Error talking to trello " + error.responseText
        }
        $failure.text(message)
        $failure.removeClass('hidden')
      }
    },

    fetchSomething: function(description, storageKey, call, success) {
      var fullStorageKey = TRELLOVIEW.boardId + "_" + storageKey
      var responseObj = $.jStorage.get(fullStorageKey)
      if (responseObj) {
        success(responseObj)
      }

      TRELLOVIEW.startFetch(description)
      call().success(
        function(responseObj) {
          TRELLOVIEW.stopFetch(description)
          TRELLOVIEW.ajaxError()
          $.jStorage.set(fullStorageKey, responseObj)
          success(responseObj)
        }
      ).error(
        function(error) {
          TRELLOVIEW.stopFetch(description)
          TRELLOVIEW.ajaxError(error)
        }
      )
    },

    fetchMainData: function() {
      TRELLOVIEW.fetchSomething("board", "trello.mainData", function() {
        return Trello.boards.get(TRELLOVIEW.boardId)
      }, TRELLOVIEW.updateMainData)
    },

    fetchLabels: function() {
      TRELLOVIEW.fetchSomething("labels", "trello.labels", function() {
        return Trello.boards.get(TRELLOVIEW.boardId + "/labels")
      }, TRELLOVIEW.updateLabels)
    },

    fetchLists: function() {
      TRELLOVIEW.fetchSomething("lists", "trello.lists", function() {
        return Trello.boards.get(TRELLOVIEW.boardId + "/lists")
      }, TRELLOVIEW.updateLists)
    },

    fetchCards: function() {
      TRELLOVIEW.fetchSomething("cards", "trello.cards", function() {
        return Trello.boards.get(TRELLOVIEW.boardId + "/cards", {"actions": "all", "attachments": "true"})
      }, TRELLOVIEW.updateCards)
    },


    updateMainData: function(responseObj) {
      var $title = $(".board-title")
      $title.text(responseObj.name)
      $title.attr("href", responseObj.shortUrl)
    },

    updateLists: function(responseObj) {
      TRELLOVIEW.listData = responseObj
      TRELLOVIEW.buildLists()
    },

    updateCards: function(responseObj) {
      TRELLOVIEW.cardData = responseObj
      TRELLOVIEW.buildLists()
    },

    updateLabels: function(responseObj) {
      TRELLOVIEW.labelData = responseObj
      TRELLOVIEW.buildLists()
    },

    buildLists: function() {
      var newLists = Object.create(null),
          newLabels = Object.create(null),
          newCards = [],
          newLabelTypes = Object.create(null)

      if (TRELLOVIEW.labelData) {
        $.each(TRELLOVIEW.labelData, function(index, label) {
          newLabels[label.id] = new Label(label)
        })

        $.each(newLabels, function(id, label) {
          var type = newLabelTypes[label.type]
          if (!type) {
            type = newLabelTypes[label.type] = new LabelType(label.type)
          }
          type.push(label)
        })
      }

      if (TRELLOVIEW.listData) {
        $.each(TRELLOVIEW.listData, function(index, list) {
          newLists[list.id] = new List(list)
        })
      }

      if (TRELLOVIEW.cardData) {
        newCards = TRELLOVIEW.cardData.map(function(cardData) {
          var list = newLists[cardData.idList],
              card, labels = []
          if (list) {
            $.each(cardData.idLabels, function(index, labelId) {
              var label = newLabels[labelId]
              if (label) {
                labels.push(label)
              }
            })

            card = new TRELLOVIEW.Card(cardData, list, labels)
            list.cards.push(card)
            $.each(labels, function(index, label) {
              label.cards.push(card)
            })
          }
          return card
        })
      }

      TRELLOVIEW.lists = newLists
      TRELLOVIEW.labels = newLabels
      TRELLOVIEW.labelTypes = newLabelTypes
      TRELLOVIEW.cards = newCards
      TRELLOVIEW.refreshDisplay()
    },

    refreshDisplay: function() {
      TRELLOVIEW.updateNavBar()
      TRELLOVIEW.displayLists()
    },

    updateNavBar: function() {
      var rendered = Mustache.render(TRELLOVIEW.templateLeftNavbar, {
        lists_active: TRELLOVIEW.view === 'lists',
        epics: (TRELLOVIEW.labelTypes["Epic"] || {}).labels,
        types: Object.keys(TRELLOVIEW.labelTypes).map(
          function(key) { return TRELLOVIEW.labelTypes[key] }
        )
      })
      TRELLOVIEW.$leftNavbar.html(rendered);
    },

    displayLists: function() {
      var $lists = $(".lists", TRELLOVIEW.$display);
              
      var listHtml = $.map(TRELLOVIEW.lists, function(list) {
        return list.htmlCardList()
        return list.htmlSummary()
      })
      $lists.html(listHtml)
    },


    printPrintable: function(target) {
      var $target = $(target.target),
          data = $target.data(),
          listId = data["listid"]
      TRELLOVIEW.printList(listId)
    },

    printList: function(listId) {
      var list = TRELLOVIEW.lists[listId];
      TRELLOVIEW.printCards(list.cards, list.name)
    },

    printCards: function(cards, name) {
      var doc = new jsPDF("landscape", "mm", [102, 152]),
          firstPage = true;

      $.map(cards, function(card) {
        if (firstPage) {
          firstPage = false
        } else {
          doc.addPage()
        }
        doc.text(20, 20, card.list.name)
        doc.text(20, 30, card.name)
        doc.text(20, 40, card.labels.toString())
      })
      console.log(doc);

      // Save the PDF
      doc.save('cards_' + name + '.pdf');
    },

    generatePdf: function() {
      cards
    }
  };
  TRELLOVIEW.Card = Card

}());
