(function() {
  "use strict";
  window.TRELLOVIEW = window.TRELLOVIEW || {};
  var $ = window.jQuery;

  (function(jsPDFAPI) {
    jsPDFAPI.saveContext = function() {
      this.internal.write('q')
    };
    jsPDFAPI.restoreContext = function() {
      this.internal.write('Q')
    };
    jsPDFAPI.clipInvisible = function() {
      this.internal.write('W')
      this.internal.write('n')
    };
  })(jsPDF.API);

  // Used for sorting labels
  var labelTypePriorities = {
    "Type": 1,
    "Need": 2,
    "Skill": 3,
    "Epic": 4
  }

  var actionIsMajor = {
    /* Checklit actions */
    "addChecklistToCard": false,
    "removeChecklistFromCard": false,
    "updateCheckItemStateOnCard": false,

    /* Comment actions */
    "commentCard": false,

    /* Attachment actions */
    "addAttachmentToCard": false,
    "deleteAttachmentFromCard": false,

    /* Major actions */
    "moveCardToBoard": true,
    "createCard": true,

    /* Changing membership of the card */
    "addMemberToCard": true,
    "removeMemberFromCard": true,
  }

  var trelloColours = {
    green: '61bd4f',
    yellow: 'f2d600',
    orange: 'ffab4a',
    red: 'eb5a46',
    purple: 'c377e0',
    blue: '0079bf',
    pink: 'ff80ce',
    sky: '00c2e0',
    lime: '51e898',
    black: '4d4d4d',
    grey: '7d7d7d'
  }, trelloColoursAsTriple = {}

  $.each(trelloColours, function(key, value) {
    trelloColoursAsTriple[key] = [
      (Number('0x' + value.substring(0, 2)) / 255).toString(),
      (Number('0x' + value.substring(2, 4)) / 255).toString(),
      (Number('0x' + value.substring(4, 6)) / 255).toString()
    ]
  })

  function Member(memberData) {
    this.id = memberData.id
    this.fullName = memberData.fullName
    this.initials = memberData.initials
    this.avatarHash = memberData.avatarHash
    this.username = memberData.username
    this.memberType = memberData.memberType
  }

  function Action(actionData, allMembers) {
    this.id = actionData.id
    this.data = actionData.data
    this.date = Date.parse(actionData.date)
    this.type = actionData.type
    this.member = allMembers[actionData.idMemberCreator]
    this.major = this.checkMajor()
  }

  Action.prototype.checkMajor = function() {
    var isMajor = actionIsMajor[this.type]
    if (isMajor === true || isMajor == false) {
      return isMajor
    }
    if (this.type === "updateCard") {
      isMajor = false
      $.each(this.data.old, function(key, value) {
        if (key === "idList" ||
            key === "idAttachmentCover" ||
            key === "pos" ||
            key === "desc" ||
            key === "due") {
           // Minor
        } else if (key === "name") {
           isMajor = true
        } else {
          console.log("Unknown key in updateCard action: " + key, this)
        }
      })
      return isMajor
    } else {
      console.log("Unknown action type: " + this.type, this)
    }
  }

  function List(listData) {
    this.id = listData.id
    this.name = listData.name
    this.cards = new CardList
  }

  CardList.prototype.filtered = function(filter_fmd) {
    var result = []
    if (filter_fmd) {
      filter_fmd = Date.parse(filter_fmd)
    }
    $.each(this.cards, function(index, card) {
      if (filter_fmd) {
        if (card.dateLastMajorActivity >= filter_fmd) {
          result.push(card)
        }
      } else {
        result.push(card)
      }
    })
    return result
  }


  function Label(labelData, allLists) {
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
    this.cards = new CardList
    this.allLists = allLists
  }

  Label.prototype.calcProperties = function() {
    this.dateLastActivity = this.calcDateLastActivity()
  }

  function displayDate(timestamp) {
    var obj
    if (timestamp) {
      obj = new Date(timestamp)
    } else {
      obj = new Date()
    }
    return obj.getUTCFullYear() + "/" + obj.getUTCMonth() + "/" + obj.getUTCDate()
  }

  Label.prototype.calcDateLastActivity = function() {
    var result = null
    $.each(this.cards.cards, function(index, card) {
      if (card.dateLastActivity > result) {
        result = card.dateLastActivity
      }
    })
    return result
  }

  Label.prototype.lists = function() {
    var result = [], self = this
    $.each(this.allLists, function(id, list) {
      var newList = new List({
        id: list.id,
        name: list.name
      })
      $.each(self.cards.cards, function(index, card) {
        if (card.list.id === newList.id) {
          newList.cards.push(card)
        }
      })
      if (newList.cards.length() > 0) {
        result.push(newList)
      }
    })
    return result
  }

  function LabelType(type) {
    this.type = type
    this.labels = []
  }

  LabelType.prototype.push = function(label) {
    this.labels.push(label)
  }

  LabelType.prototype.sortedLabels = function() {
    var labels = this.labels || []
    labels.sort(function(a, b) {
      if (a.color && !b.color) return -1
      if (!a.color && b.color) return 1
      return (a.dateLastActivity < b.dateLastActivity) ? 1 : ((a.dateLastActivity > b.dateLastActivity) ? -1 : 0)
    })
    return labels
  }

  function CardList() {
    this.cards = []
  }

  CardList.prototype.push = function(item) {
    this.cards.push(item)
  }

  CardList.prototype.calcProperties = function() {
  }

  CardList.prototype.all = function() {
    return this.cards
  }

  CardList.prototype.length = function() {
    return this.cards.length
  }


  function Card(cardData, list, sortedLabels, allMembers) {
    this.list = list
    this.name = cardData.name
    this.idShort = cardData.idShort
    this.shortUrl = cardData.shortUrl
    this.description = cardData.desc
    this.dateLastActivity = Date.parse(cardData.dateLastActivity)
    this.dateCreated = this.calcDateCreated(cardData)
    this.labels = this.calcLabels(cardData, sortedLabels)
    this.members = this.calcMembers(cardData, allMembers)
    this.labelsByType = this.calcLabelsByType()
    this.epic = this.labelsByType.Epic ? this.labelsByType.Epic[0] : null
    this.type = this.labelsByType.Type ? this.labelsByType.Type[0] : null
    this.actions = $.map(cardData.actions, function(actionData) {
      return new Action(actionData, allMembers)
    })

    this.dateLastMajorActivity = this.calcDateLastMajorActivity()
  }

  Card.prototype.calcDateLastMajorActivity = function() {
    var result = null
    $.each(this.actions, function(index, action) {
      if (action.major) {
        if (result === null || result < action.date) {
          result = action.date
        }
      }
    })
    return result
  }

  Card.prototype.calcDateCreated = function(cardData) {
    if (cardData.actions) {
      return Date.parse(cardData.actions[cardData.actions.length - 1].date)
    } else {
      return null
    }
  }

  Card.prototype.calcLabels = function(cardData, sortedLabels) {
    var result = []
    $.each(sortedLabels, function(index, label) {
      if (cardData.idLabels.indexOf(label.id) != -1) {
        result.push(label)
      }
    })
    return result
  }

  Card.prototype.calcMembers = function(cardData, allMembers) {
    var self = this, result = []
    $.each(cardData.idMembers, function(index, memberId) {
      var member = allMembers[memberId]
      if (member) {
        result.push(member)
      }
    })
    return result
  }

  Card.prototype.calcLabelsByType = function() {
    var result = Object.create(null)
    $.each(this.labels, function(index, label) {
      if (!result[label.type]) {
        result[label.type] = []
      }
      result[label.type].push(label)
    })

    return result
  }

  var textInArea = function(doc, text, x1, y1, x2, y2, align) {
    var lines,
        lineHeight = doc.getLineHeight(),
        descenderProportion = 0.25,
        x

    //console.log("textInArea", text, x, y1, x2 - x1, y2 - y1, align)

    doc.saveContext()
    doc.rect(x1, y1, x2 - x1, y2 - y1, null).clipInvisible()

/*
doc.setLineWidth(1)
doc.setDrawColor("0.00", "0.70", "0.00")
doc.rect(x1, y1, x2 - x1, y2 - y1)
*/

    lines = doc.splitTextToSize(text, x2 - x1, {fontName: 'helvetica', fontStyle: 'normal'})
    if (align === "center") {
      x = (x1 + x2) / 2
    } else if (align === "right") {
      x = x2
    } else {
      x = x1
    }

    doc.text(lines, x, y1 + lineHeight * (1 - descenderProportion), {}, null, align)
    doc.restoreContext()
  }

  var colorTupleForLabel = function(label) {
    if (label && label.color) {
      return trelloColoursAsTriple[label.color]
    } else {
      return trelloColoursAsTriple.grey
    }
  }

  var setDrawColorForLabel = function(doc, label) {
    var color = colorTupleForLabel(label)
    doc.setDrawColor(color[0], color[1], color[2])
  }

  var setFillColorForLabel = function(doc, label) {
    var color = colorTupleForLabel(label)
    doc.setFillColor(color[0], color[1], color[2])
  }

  Card.prototype.displayLabelBox = function(doc, label, left, top) {
    var boxProportion = 0.8,
        lineHeight = doc.getLineHeight()

    doc.setLineWidth(0.5)
    doc.setDrawColor("0.00", "0.00", "0.00")
    setFillColorForLabel(doc, label)

    doc.roundedRect(
      left,
      top,
      lineHeight * boxProportion,
      lineHeight * boxProportion,
      lineHeight * 0.2,
      lineHeight * 0.2,
      "FD"
    )
  }

  Card.prototype.displayMembers = function(doc, top, bottom, left, width, textMargin) {
    var self = this,
        y_pos,
        lineHeight = doc.getLineHeight() + textMargin,
        descenderProportion = 0.25

    if (!this.members) {
      return 0
    }

    y_pos = bottom - lineHeight - textMargin
    $.each(this.members, function(index, member) {
      doc.setTextColor("#000000")

      doc.setLineWidth(1)
      doc.setDrawColor("0.00", "0.00", "0.00")
      doc.setFillColor("1.00", "1.00", "0.00")
      doc.rect(left, y_pos, width, lineHeight, "FD")

      textInArea(doc, member.fullName,
        left,
        y_pos + textMargin / 2,
        left + width,
        y_pos + lineHeight + textMargin / 2,
        "center"
      )
      y_pos -= lineHeight + textMargin
    })

  }

  Card.prototype.displayLabels = function(doc, type, heading, top, left, width, textMargin, internalLineWidth) {
    var self = this,
        labels = this.labelsByType[type],
        lineHeight = doc.getLineHeight(),
        y_pos = top,
        boxProportion = 0.8,
        descenderProportion = 0.25

    if (!labels) {
      return 0
    }

    doc.setTextColor("#000000")
    if (heading) {
      textInArea(doc, heading, left, y_pos, left + width, y_pos + lineHeight)
    }

    $.each(labels, function(index, label) {
      self.displayLabelBox(doc, label, left + width - lineHeight * boxProportion, y_pos)

      doc.setTextColor("#000000")

      textInArea(doc, label.name,
        left,
        y_pos,
        left + width - lineHeight * 0.8 - textMargin,
        y_pos + lineHeight,
        "right"
      )
      y_pos += lineHeight
    })

    y_pos += lineHeight * descenderProportion + textMargin

    doc.setDrawColor("0.00", "0.00", "0.00")
    doc.setLineWidth(internalLineWidth)
    doc.line(
      left,
      y_pos + internalLineWidth / 2,
      left + width,
      y_pos + internalLineWidth / 2
    )
    y_pos += internalLineWidth + textMargin

    return y_pos - top
  }

  Card.prototype.toPdf = function(doc) {
    var mm_to_pt = 2.83464567,
        width = 152 * mm_to_pt,
        height = 102 * mm_to_pt,
        title_size = 25,
        label_size = 12,
        members_size = 8,
        idSize = 20,
        metadataSize = 8,
        paper_margin = 5 * mm_to_pt,
        card_border_width = 2 * mm_to_pt,
        internal_line_width = 0.5 * mm_to_pt,
        text_margin = 2 * mm_to_pt,
        title_margin = 10 * mm_to_pt,
        rhs_width = 50 * mm_to_pt - text_margin * 2,
        rhs_left = width - paper_margin - card_border_width - rhs_width - text_margin - internal_line_width,
        lhs_width = width - paper_margin * 2 - card_border_width * 2 - rhs_width - internal_line_width * 3 - text_margin * 4,
        lhs_left = paper_margin + card_border_width + text_margin + internal_line_width,
        contents_bottom = height - card_border_width - paper_margin - text_margin - internal_line_width,
        contents_top = card_border_width + paper_margin + text_margin + internal_line_width,
        rhs_curr_y_pos,
        lines,
        color,
        descenderProportion = 0.25

    // Border of card, in colour based on Epic
    doc.setLineWidth(card_border_width)
    setDrawColorForLabel(doc, this.epic)
    doc.rect(
      card_border_width / 2 + paper_margin,
      card_border_width / 2 + paper_margin,
      width - card_border_width - paper_margin * 2,
      height - card_border_width - paper_margin * 2
    )

    // Internal dividing lines and border, in black
    doc.setDrawColor("0.00", "0.00", "0.00")
    doc.setLineWidth(internal_line_width)
    doc.rect(
      card_border_width + internal_line_width / 2 + paper_margin,
      card_border_width + internal_line_width / 2 + paper_margin,
      width - card_border_width * 2 - paper_margin * 2 - internal_line_width,
      height - card_border_width * 2 - paper_margin * 2 - internal_line_width
    )

    doc.line(
      rhs_left - text_margin - internal_line_width / 2,
      card_border_width + paper_margin,
      rhs_left - text_margin - internal_line_width / 2,
      height - card_border_width - paper_margin
    )
    doc.rect(
      card_border_width + internal_line_width + paper_margin,
      card_border_width + internal_line_width + paper_margin,
      width - card_border_width * 2 - paper_margin * 2 - internal_line_width * 2,
      height - card_border_width * 2 - paper_margin * 2 - internal_line_width * 2,
      null
    ).clipInvisible()

    // Card type as coloured box at top left
    doc.setFontSize(label_size)
    if (this.type) {
      doc.setLineWidth(0.5)
      doc.setDrawColor("0.00", "0.00", "0.00")
      setFillColorForLabel(doc, this.type)
      doc.triangle(
        lhs_left - text_margin - 10,
        contents_top - text_margin - 10,
        lhs_left + text_margin + 20,
        contents_top - text_margin - 10,
        lhs_left - text_margin - 10,
        contents_top + text_margin + 20,
        "FD"
      )
    }

    // Card description in LHS
    doc.setFontSize(title_size)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor("#000000")
    textInArea(doc, this.name,
      lhs_left,
      contents_top,
      lhs_left + lhs_width,
      contents_bottom,
      "center"
    )

    // Labels on RHS
    doc.setFontSize(label_size)
    doc.setFont('helvetica', 'normal')
    rhs_curr_y_pos = contents_top

    rhs_curr_y_pos += this.displayLabels(doc, 'Need', 'Need:', rhs_curr_y_pos, rhs_left, rhs_width, text_margin, internal_line_width)

    rhs_curr_y_pos += this.displayLabels(doc, 'Skill', 'Skill:', rhs_curr_y_pos, rhs_left, rhs_width, text_margin, internal_line_width)

    rhs_curr_y_pos += this.displayLabels(doc, 'Epic', null, rhs_curr_y_pos, rhs_left, rhs_width, text_margin, internal_line_width)

    doc.setFontSize(members_size)
    this.displayMembers(doc, contents_top, contents_bottom, rhs_left, rhs_width, text_margin)

    if (this.idShort) {
      doc.setFontSize(idSize)
      doc.setTextColor("#404040")
      textInArea(doc, '#' + this.idShort.toString(),
        lhs_left,
        contents_bottom - doc.getLineHeight() * (1 + descenderProportion),
        lhs_left + lhs_width,
        contents_bottom
      )
    }

    doc.setFontSize(metadataSize)
    doc.setTextColor("#40ff40")
    textInArea(doc,
      "Created:" + displayDate(this.dateCreated) +
      "  MajorUpdate:" + displayDate(this.dateLastMajorActivity) +
      "  Printed:" + displayDate(null),
      lhs_left,
      contents_bottom + text_margin - doc.getLineHeight(),
      lhs_left + lhs_width,
      contents_bottom + text_margin
    )
  }

  TRELLOVIEW = {

    init: function(queryParams) {
      var key = queryParams["k"] || '4e6c185d2c22ee0f51332d0a1657eaeb'
      Trello.setKey(key)
      TRELLOVIEW.boardId = queryParams["b"]
      TRELLOVIEW.view = queryParams["v"] || 'lists'
      TRELLOVIEW.epicId = queryParams["e"]
      TRELLOVIEW.filter_fmd = queryParams["fmd"]

      TRELLOVIEW.loadTemplates()
      TRELLOVIEW.prepareLayout()

      TRELLOVIEW.fetchesInProgress = Object.create(null)
      TRELLOVIEW.buildLists()

      TRELLOVIEW.$content.on("click", ".printable", TRELLOVIEW.printPrintable)
      TRELLOVIEW.$filters.on("change", "#fmd", TRELLOVIEW.updateDate)
      TRELLOVIEW.$filters.on("blur", "#fmd", TRELLOVIEW.updateDate)
    },

    updateDate: function(e) {
      TRELLOVIEW.filter_fmd = e.target.value
      TRELLOVIEW.refreshDisplay()
      return false
    },

    loadTemplates: function() {
      var templates = Object.create(null)
      $('script[type="x-tmpl-mustache"]').each(function(index, tag) {
        var templateName = tag.id.replace("template-", "")
        var templateHtml = $(tag).html()
        templates[templateName] = templateHtml
        Mustache.parse(templateHtml);
      })
      TRELLOVIEW.templates = templates
    },

    prepareLayout: function() {
      TRELLOVIEW.$content = $("#content")
      TRELLOVIEW.$leftNavbar = $("#left-navbar")
      TRELLOVIEW.$filters = $("#filters")
    },

    fetch: function() {
      TRELLOVIEW.fetchMainData()
      TRELLOVIEW.fetchLabels()
      TRELLOVIEW.fetchLists()
      TRELLOVIEW.fetchCards()
      TRELLOVIEW.fetchMembers()
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

    fetchMembers: function() {
      TRELLOVIEW.fetchSomething("members", "trello.members", function() {
        return Trello.boards.get(TRELLOVIEW.boardId + "/members", {
          "fields": "fullName,username,avatarHash,initials,memberType"
        })
      }, TRELLOVIEW.updateMembers)
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

    updateMembers: function(responseObj) {
      TRELLOVIEW.memberData = responseObj
      TRELLOVIEW.buildLists()
    },

    updateLabels: function(responseObj) {
      TRELLOVIEW.labelData = responseObj
      TRELLOVIEW.buildLists()
    },

    buildLists: function() {
      var newLists = Object.create(null),
          newLabels = Object.create(null),
          newSortedLabels = [],
          newCards = new CardList,
          newLabelTypes = Object.create(null),
          newMembers = Object.create(null)

      if (TRELLOVIEW.memberData) {
        $.each(TRELLOVIEW.memberData, function(index, member) {
          newMembers[member.id] = new Member(member)
        })
      }

      if (TRELLOVIEW.listData) {
        $.each(TRELLOVIEW.listData, function(index, list) {
          newLists[list.id] = new List(list)
        })
      }

      if (TRELLOVIEW.labelData) {
        $.each(TRELLOVIEW.labelData, function(index, label) {
          var newLabel = new Label(label, newLists)
          newLabels[label.id] = newLabel
          newSortedLabels.push(newLabel)
        })

        newSortedLabels.sort(function(a, b) {
          var p_a = labelTypePriorities[a.type] || 10000,
              p_b = labelTypePriorities[b.type] || 10000

          if (p_a < p_b) {
            return -1
          } else if (p_a > p_b) {
            return 1
          }
          if (a.color && !b.color) return -1
          if (!a.color && b.color) return 1
          return (a.dateLastActivity < b.dateLastActivity) ? 1 : ((a.dateLastActivity > b.dateLastActivity) ? -1 : 0)
        })

        $.each(newSortedLabels, function(_, label) {
          var type = newLabelTypes[label.type]
          if (!type) {
            type = newLabelTypes[label.type] = new LabelType(label.type)
          }
          type.push(label)
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

            card = new Card(cardData, list, newSortedLabels, newMembers)
            list.cards.push(card)
            $.each(labels, function(index, label) {
              label.cards.push(card)
            })
          }
          return card
        })
      }

      if (TRELLOVIEW.labelData) {
        $.each(newLabels, function(index, label) {
          label.calcProperties()
        })
      }

      TRELLOVIEW.members = newMembers
      TRELLOVIEW.lists = newLists
      TRELLOVIEW.labels = newLabels
      TRELLOVIEW.sortedLabels = newSortedLabels
      TRELLOVIEW.labelTypes = newLabelTypes
      TRELLOVIEW.cards = newCards
      TRELLOVIEW.refreshDisplay()
    },

    refreshDisplay: function() {
      TRELLOVIEW.updateNavBar()
      if (TRELLOVIEW.view == 'lists') {
        TRELLOVIEW.updateFilters(true)
        TRELLOVIEW.displayLists()
      } else if (TRELLOVIEW.view == 'epic') {
        TRELLOVIEW.updateFilters(false)
        TRELLOVIEW.displayEpic()
      }
    },

    sortedEpics: function() {
      var labelType = TRELLOVIEW.labelTypes["Epic"],
          labels;
      if (labelType) {
        return labelType.sortedLabels()
      } else {
        return []
      }
    },

    objectValues: function(object) {
      return Object.keys(object).map(
        function(key) {
          return object[key]
        }
      )
    },

    render: function(templateName, $target, context) {
      $target.html(Mustache.render(TRELLOVIEW.templates[templateName], context))
    },

    updateNavBar: function() {
      TRELLOVIEW.render('left-navbar', TRELLOVIEW.$leftNavbar, {
        boardID: TRELLOVIEW.boardId,
        listsActive: TRELLOVIEW.view === 'lists',
        epics: TRELLOVIEW.sortedEpics(),
        types: TRELLOVIEW.objectValues(TRELLOVIEW.labelTypes)
      })
    },

    passedFilters: function(card) {
      var fmd = TRELLOVIEW.filter_fmd
      if (!fmd) {
        return true
      }

      console.log(card.dateLastMajorActivity, fmd)
    },

    updateFilters: function(show) {
      if (TRELLOVIEW.filtersShown) {
        if (!show) {
          TRELLOWVIEW.$filters.hide()
          TRELLOVIEW.filtersShown = false
        }
      } else {
        if (show) {
          TRELLOVIEW.render('filters', TRELLOVIEW.$filters, {
            boardID: TRELLOVIEW.boardId,
            fmd: TRELLOVIEW.filter_fmd,
          })
          TRELLOVIEW.$filters.show()
          TRELLOVIEW.filtersShown = true
        }
      }
    },

    displayLists: function() {
      var lists = []
      $.each(TRELLOVIEW.lists, function(key, value) {
        var filteredCards = value.cards.filtered(TRELLOVIEW.filter_fmd)
        lists.push({
          name: value.name,
          id: value.id,
          cards: { cards: filteredCards }
        })
      })
      TRELLOVIEW.render('lists', TRELLOVIEW.$content, {
        lists: lists
      })
    },

    displayEpic: function() {
      var epic = TRELLOVIEW.labels[TRELLOVIEW.epicId]
      if (!epic) return

      TRELLOVIEW.render('epic', TRELLOVIEW.$content, {
        epic: epic,
        lists: epic.lists()
      })
    },


    printPrintable: function(target) {
      var $target = $(target.target),
          data = $target.data(),
          listId = data["listid"]
      console.log($target)
      TRELLOVIEW.printList(listId)
    },

    printList: function(listId) {
      var list = TRELLOVIEW.lists[listId];
      TRELLOVIEW.printCards(list.cards, list.name)
    },

    printCards: function(cardlist, name) {
      var doc = new jsPDF("landscape", "pt", [102 * 2.83464567, 152 * 2.83464567]),
          firstPage = true;

      delete doc.internal.getFont().metadata.Unicode.kerning[97][84]
      delete doc.internal.getFont().metadata.Unicode.kerning[101][84]
      delete doc.internal.getFont().metadata.Unicode.kerning[114][84]
      delete doc.internal.getFont().metadata.Unicode.kerning[117][84]
      doc.setProperties({
        title: 'Title',
        subject: 'Subject',
        author: 'trelloview',
        keywords: 'trello',
        creator: 'trelloview'
      });

      $.each(cardlist.filtered(TRELLOVIEW.filter_fmd), function(index, card) {
        if (firstPage) {
          firstPage = false
        } else {
          doc.addPage()
        }
        card.toPdf(doc)
      })

      // Save the PDF
      doc.save('cards_' + name + '.pdf');
    },

    generatePdf: function() {
      cards
    }
  };

}());
