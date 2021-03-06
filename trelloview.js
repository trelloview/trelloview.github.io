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
    "Feature": 4,
  }

  var actionIsMajor = {
    /* Checklist actions */
    "addChecklistToCard": false,
    "removeChecklistFromCard": false,
    "updateCheckItemStateOnCard": false,

    /* Comment actions */
    "commentCard": false,
    "copyCommentCard": false,

    /* Attachment actions */
    "addAttachmentToCard": false,
    "deleteAttachmentFromCard": false,

    /* Major actions */
    "moveCardToBoard": true,
    "createCard": true,
    "copyCard": true,
    "convertToCardFromCheckItem": true,

    /* Changing membership of the card */
    "addMemberToCard": false,
    "removeMemberFromCard": false,
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
    if (!this.member && allMembers.length > 0) {
      console.log("Unknown memberID in action: " + actionData.idMemberCreator, actionData)
    }
    this.major = this.checkMajor()
  }

  Action.prototype.checkMajor = function() {
    var isMajor = actionIsMajor[this.type]
    if (isMajor === true || isMajor === false) {
      return isMajor
    }
    if (this.type === "updateCard") {
      isMajor = false
      $.each(this.data.old, function(key, value) {
        if (key === "idList" ||
            key === "idAttachmentCover" ||
            key === "pos" ||
            key === "desc" ||
            key === "due" ||
            key === "closed") {
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

  CardList.prototype.filtered = function(update_since, major_updates, showUnchanged, featureId) {
    var result = [], cardFeatures

    if (update_since) {
      update_since = Date.parse(update_since)
    }
    $.each(this.cards, function(index, card) {
      var wanted = true
      if (update_since) {
        if (!showUnchanged) {
          if (major_updates && card.dateLastMajorActivity < update_since) {
            wanted = false
          } else if (card.dateLastActivity < update_since) {
            wanted = false
          }
        }
      }
      if (wanted && featureId) {
        cardFeatures = card.labelsByType.Feature || []
        if (featureId === "NONE") {
          if (cardFeatures.length > 0) {
            wanted = false
          }
        } else {
          var foundMatch = false
          $.each(cardFeatures, function(index, cardFeature) {
            if (cardFeature.id === featureId) {
              foundMatch = true
            }
          })
          if (!foundMatch) {
            wanted = false
          }
        }
      }
      if (wanted) {
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
    this.feature = this.labelsByType.Feature ? this.labelsByType.Feature[0] : null
    this.type = this.labelsByType.Type ? this.labelsByType.Type[0] : null
    this.actions = $.map(cardData.actions, function(actionData) {
      return new Action(actionData, allMembers)
    })

    this.dateLastMajorActivity = this.calcDateLastMajorActivity()
  }

  Card.prototype.changes = function(update_since) {
    var results = [],
        start_list, end_list, created = false, created_by,
        actionCount = 0,
        checklistModifications = Object.create(null),
        comments = [],
        memberIdsChanged = Object.create(null),
        originalName,
        originalDescription,
        movedPosition = false,
        changedDueDate = false,
        cardSource,
        checklistSource,
        boardSource

    $.each(this.actions, function(index, action) {
      if (update_since && action.date < update_since) {
        return
      }
      actionCount += 1
      if (action.type === "updateCard") {
        var handled = false
        if (action.data.listAfter && action.data.listBefore) {
          if (!end_list) {
            end_list = action.data.listAfter
          }
          start_list = action.data.listBefore
          handled = true
        }
        if (action.data.old.name) {
          originalName = action.data.old.name
          handled = true
        }
        if (action.data.old.desc != null) {
          originalDescription = action.data.old.desc
          movedPosition = true
          handled = true
        }
        if (action.data.old.pos) {
          handled = true
        }
        if (action.data.old.due !== undefined) {
          changedDueDate = true
          handled = true
        }
        if (!handled) {
          console.log("unknown update", action.data)
        }
      } else if (action.type === "commentCard") {
        comments.push({
          commenter: action.member,
          text: action.data.text,
        })
      } else if (action.type === "copyCommentCard") {
        comments.push({
          commenter: action.member,
          text: "COPY:" + action.data.text,
        })
      } else if (action.type === "createCard") {
        created = true
        created_by = action.member
        if (action.data.list) {
          if (!end_list) {
            end_list = action.list
          }
        }
      } else if (action.type === "copyCard") {
        created = true
        created_by = action.member
        cardSource = action.data.cardSource.name
        if (action.data.list) {
          if (!end_list) {
            end_list = action.list
          }
        }
      } else if (action.type === "convertToCardFromCheckItem") {
        created = true
        created_by = action.member
        checklistSource = action.data.cardSource.name
        if (action.data.list) {
          if (!end_list) {
            end_list = action.list
          }
        }
      } else if (action.type === "moveCardToBoard") {
        created = true
        created_by = action.member
        boardSource = action.data.boardSource.name
        if (action.data.list) {
          if (!end_list) {
            end_list = action.list
          }
        }
      } else if (action.type === "addMemberToCard") {
        var memberId = action.data.idMember
        memberIdsChanged[memberId] = (memberIdsChanged[memberId] || 0) + 1
      } else if (action.type === "removeMemberFromCard") {
        var memberId = action.data.idMember
        memberIdsChanged[memberId] = (memberIdsChanged[memberId] || 0) - 1
      } else if (action.type === "addChecklistToCard" ||
          action.type === "removeChecklistFromCard" ||
          action.type === "updateCheckItemStateOnCard"
      ) {
        var checklist = action.data.checklist
        checklistModifications[checklist.id] = checklist.name
      } else {
        console.log("Unknown action:", action.type, action)
      }

    })

    if (created) {
      results.push({
        "type": "createdBy",
        "created_by": created_by,
        "cardSource": cardSource,
        "checklistSource": checklistSource,
        "boardSource": boardSource,
        "cardSource?": cardSource !== undefined,
        "checklistSource?": checklistSource !== undefined,
        "boardSource?": boardSource !== undefined,
      })
    } else {
      if (originalName) {
        var wikEdDiff = new WikEdDiff();
        results.push({
          "type": "titleChange",
          "oldTitle": originalName,
          "newTitle": this.name,
          // "diff":  wikEdDiff.diff(originalName, this.name)
          "diff": diffString(originalName, this.name),
        })
      }

      if (originalDescription) {
        var wikEdDiff = new WikEdDiff();
        results.push({
          "type": "descriptionChange",
          "oldDescription": originalDescription,
          "newDescription": this.description,
          // "diff":  wikEdDiff.diff(originalDescription, this.description)
          "diff": diffString(originalDescription, this.description),
        })
      }

      if (start_list && end_list && start_list.id !== end_list.id) {
        results.push({
          "type": "moveList",
          "start_list": start_list,
          "end_list": end_list,
        })
      } else if (movedPosition) {
        results.push({
          "type": "movePosition",
        })
      }

      if (changedDueDate) {
        results.push({
          "type": "changedDueDate",
        })
      }
    }

    $.each(memberIdsChanged, function(memberId, change) {
      var member = TRELLOVIEW.members[memberId]
      if (member === null || change === 0) {
        return
      }
      if (change > 0) {
        results.push({
          "type": "memberChange",
          "change": "added",
          "member": member
        })
      } else {
        results.push({
          "type": "memberChange",
          "change": "removed",
          "member": member
        })
      }
    })

    if (comments.length != 0) {
      comments.reverse()
      results.push({
        "type": "comments",
        "comments": comments,
      })
    }

    if (!created) {
      $.each(checklistModifications, function(id, name) {
        results.push({
          "type": "checklist",
          "list_id": id,
          "list_name": name,
        })
      })
    }


    return results
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

    // Border of card, in colour based on Feature
    doc.setLineWidth(card_border_width)
    setDrawColorForLabel(doc, this.feature)
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

    rhs_curr_y_pos += this.displayLabels(doc, 'Feature', null, rhs_curr_y_pos, rhs_left, rhs_width, text_margin, internal_line_width)

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

      TRELLOVIEW.authState = null
      TRELLOVIEW.boardId = queryParams["b"]
      TRELLOVIEW.view = queryParams["v"] || 'lists'
      TRELLOVIEW.featureId = queryParams["e"]
      TRELLOVIEW.update_since = queryParams["update_since"]
      TRELLOVIEW.major_updates = queryParams["major_updates"] === "1"
      TRELLOVIEW.showLabels = queryParams["showLabels"] === "1"
      TRELLOVIEW.showChanges = queryParams["showChanges"] === "1"
      TRELLOVIEW.showUnchanged = queryParams["showUnchanged"] === "1"
      TRELLOVIEW.showFullChanges = queryParams["showFullChanges"] === "1"
      TRELLOVIEW.reverse = queryParams["reverse"] === "1"

      TRELLOVIEW.loadTemplates()
      TRELLOVIEW.prepareLayout()

      TRELLOVIEW.fetchesInProgress = Object.create(null)
      TRELLOVIEW.buildLists()

      TRELLOVIEW.$content.on("click", ".printable", TRELLOVIEW.printPrintable)
      TRELLOVIEW.$filters.on("change", "#update_since", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("blur", "#update_since", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("change", "#major_updates", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("blur", "#major_updates", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("change", "#show_labels", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("blur", "#show_labels", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("change", "#show_changes", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("blur", "#show_changes", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("change", "#show_unchanged", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("blur", "#show_unchanged", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("change", "#showFullChanges", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("blur", "#showFullChanges", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("change", "#filter_feature", TRELLOVIEW.filterFormChanged)
      TRELLOVIEW.$filters.on("submit", "#filter-form", TRELLOVIEW.filterFormChanged)
    },

    filterFormChanged: function(e) {
      TRELLOVIEW.update_since = $("#update_since").val()
      TRELLOVIEW.major_updates = $("#major_updates").prop("checked")
      TRELLOVIEW.showLabels = $("#show_labels").prop("checked")
      TRELLOVIEW.showChanges = $("#show_changes").prop("checked")
      TRELLOVIEW.showUnchanged = $("#show_unchanged").prop("checked")
      TRELLOVIEW.showFullChanges = $("#showFullChanges").prop("checked")
      TRELLOVIEW.featureId = $("#filter_feature").val()
      TRELLOVIEW.updateLocation()
      TRELLOVIEW.refreshDisplay()
      return false
    },

    updateLocation: function() {
      var params = Object.create(null), uri

      params["b"] = TRELLOVIEW.boardId
      params["v"] = TRELLOVIEW.view
      if (TRELLOVIEW.featureId) {
        params["e"] = TRELLOVIEW.featureId
      }
      if (TRELLOVIEW.update_since) {
        params["update_since"] = TRELLOVIEW.update_since
      }
      if (TRELLOVIEW.major_updates) {
        params["major_updates"] = "1"
      }
      if (TRELLOVIEW.showLabels) {
        params["showLabels"] = "1"
      }
      if (TRELLOVIEW.showChanges) {
        params["showChanges"] = "1"
      }
      if (TRELLOVIEW.showUnchanged) {
        params["showUnchanged"] = "1"
      }
      if (TRELLOVIEW.showFullChanges) {
        params["showFullChanges"] = "1"
      }

      uri = "?" + $.map(params, function(value, key) {
        return URI.encodeQuery(key) + "=" + URI.encodeQuery(value)
      }).join("&")

      history.replaceState({}, '', uri)
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
      TRELLOVIEW.$filterForm = $("#filter-form")
    },

    indexPage: function() {
      var $previouslyViewed = $("#previouslyViewed"),
          boards = $.jStorage.get("boards"),
          context = {
            boards: $.map(boards, function(data, id) {
              data['id'] = id
              return data
            })
          }
      if (context.boards.length > 0) {
        TRELLOVIEW.renderToTarget('previouslyViewed', $previouslyViewed, context)
      }
    },

    tryAuth: function() {
      if (TRELLOVIEW.authState === 'trying') {
        // Already trying
        return
      }
      if (TRELLOVIEW.authState === 'failed') {
        // Given up
        return
      }
      if (TRELLOVIEW.authState === 'ok') {
        // Already done
        return
      }

      if (TRELLOVIEW.authState === null) {
        TRELLOVIEW.authState = 'trying'

        Trello.authorize({
          interactive: false,
          name: 'TrelloView',
          scope: { read: true, write: true, account: false },
          success: TRELLOVIEW.onStoredAuthOkay,
          error: TRELLOVIEW.onStoredAuthFail,
        })
      } else {
        TRELLOVIEW.authState = 'trying'
        Trello.deauthorize()
        Trello.authorize({
          type: 'redirect',
          name: 'TrelloView',
          scope: { read: true, write: true, account: false },
          success: TRELLOVIEW.onAuthOkay,
          error: TRELLOVIEW.onAuthError
        })
      }
    },

    onStoredAuthFail: function() {
      TRELLOVIEW.authState = 'stored'
      TRELLOVIEW.tryAuth()
    },

    onStoredAuthOkay: function() {
      TRELLOVIEW.authState = 'stored'
      TRELLOVIEW.fetch()
    },

    onAuthOkay: function() {
      TRELLOVIEW.authState = 'ok'
      TRELLOVIEW.fetch()
    },

    onAuthError: function() {
      TRELLOVIEW.authState = 'failed'
      TRELLOVIEW.fetch()
    },

    fetch: function() {
      TRELLOVIEW.fetchMainData()
      TRELLOVIEW.fetchLabels()
      TRELLOVIEW.fetchLists()
      TRELLOVIEW.fetchCards()
      TRELLOVIEW.fetchMembers()
      window.setTimeout(TRELLOVIEW.fetch, 300000)
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
      //error = undefined
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
      var fullStorageKey = TRELLOVIEW.boardId + "_" + storageKey,
          responseObj = $.jStorage.get(fullStorageKey),
          requestAuthState = TRELLOVIEW.authState
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
          if (error.status === 401 &&
              TRELLOVIEW.authState !== 'failed' &&
              TRELLOVIEW.authState === requestAuthState) {
            TRELLOVIEW.tryAuth()
          } else {
            TRELLOVIEW.ajaxError(error)
          }
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
        return Trello.boards.get(TRELLOVIEW.boardId + "/cards", {"actions": "all", "attachments": "true", "checkItemStates": "true", "checklists": "all", "members": "true"})
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
      var $title = $(".board-title"),
          boards
      $title.text(responseObj.name)
      $title.attr("href", responseObj.shortUrl)

      boards = $.jStorage.get("boards") || Object.create(null)
      boards[TRELLOVIEW.boardId] = responseObj
      $.jStorage.set("boards", boards)
      TRELLOVIEW.boards = boards
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
        $.each(TRELLOVIEW.cardData, function(index, cardData) {
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
          newCards.push(card)
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
      if (TRELLOVIEW.view === 'lists') {
        TRELLOVIEW.updateNavBar()
        TRELLOVIEW.updateFilters(true)
        TRELLOVIEW.displayLists(false)
      } else if (TRELLOVIEW.view === 'brief') {
        $(".navbar").hide()
        TRELLOVIEW.updateFilters(false)
        TRELLOVIEW.displayLists(true)
      } else if (TRELLOVIEW.view === 'epic') {
        TRELLOVIEW.updateNavBar()
        TRELLOVIEW.updateFilters(false)
        TRELLOVIEW.displayFeature()
      } else if (TRELLOVIEW.view === 'status') {
        TRELLOVIEW.updateNavBar()
        TRELLOVIEW.updateFilters(false)
        TRELLOVIEW.displayStatus()
      }
    },

    sortedFeatures: function() {
      var labelType = TRELLOVIEW.labelTypes["Feature"],
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

    render: function(templateName, context) {
      return Mustache.render(TRELLOVIEW.templates[templateName], context)
    },

    renderToTarget: function(templateName, $target, context) {
      $target.html(TRELLOVIEW.render(templateName, context))
    },

    updateNavBar: function() {
      var context = {
        boardID: TRELLOVIEW.boardId,
        listsActive: TRELLOVIEW.view === 'lists',
        features: TRELLOVIEW.sortedFeatures(),
        types: TRELLOVIEW.objectValues(TRELLOVIEW.labelTypes)
      }
      TRELLOVIEW.renderToTarget('left-navbar', TRELLOVIEW.$leftNavbar, context)
    },

    renderChanges: function(changes) {
      var messages = $.map(changes, function(change, index) {
        var tmpl = "change-" + change.type
        change['showFullChanges'] = TRELLOVIEW.showFullChanges
        return TRELLOVIEW.render(tmpl, change)
      })
      return messages.join("")
    },

    updateFilters: function(show) {
      var features = []
      if (TRELLOVIEW.labelTypes && TRELLOVIEW.labelTypes.Feature) {
        $.each(TRELLOVIEW.labelTypes.Feature.labels, function(index, feature) {
          features.push({
            name: feature.name,
            id: feature.id,
            color: feature.color,
            selected: feature.id === TRELLOVIEW.featureId,
            cardCount: feature.cards.cards.length,
          })
        })
      }
      if (TRELLOVIEW.filtersShown && !show) {
          TRELLOWVIEW.$filters.hide()
          TRELLOVIEW.filtersShown = false
      } else if (show && (!TRELLOVIEW.filtersShown || features != TRELLOVIEW.shownFeatures)) {
        TRELLOVIEW.shownFeatures = features
        TRELLOVIEW.renderToTarget('filters', TRELLOVIEW.$filters, {
          boardID: TRELLOVIEW.boardId,
          update_since: TRELLOVIEW.update_since,
          major_updates: TRELLOVIEW.major_updates,
          features: features,
          show_all_features: !TRELLOVIEW.featureId,
          show_no_features: TRELLOVIEW.featureId === "NONE",
          showLabels: TRELLOVIEW.showLabels,
          showChanges: TRELLOVIEW.showChanges,
          showUnchanged: TRELLOVIEW.showUnchanged,
          showFullChanges: TRELLOVIEW.showFullChanges,
        })
        $('.selectpicker').selectpicker()
        TRELLOVIEW.$filters.show()
        TRELLOVIEW.filtersShown = true
      }
    },

    displayLists: function(brief) {
      var lists = []
      $.each(TRELLOVIEW.lists, function(key, value) {
        var filteredCards = value.cards.filtered(TRELLOVIEW.update_since, TRELLOVIEW.major_updates, TRELLOVIEW.showUnchanged, TRELLOVIEW.featureId),
            update_since

        if (TRELLOVIEW.update_since) {
          update_since = Date.parse(TRELLOVIEW.update_since)
        }
        if (filteredCards.length > 0) {
          lists.push({
            name: value.name,
            id: value.id,
            cards: filteredCards,
            renderChanges: function() {
              var result = []
              result.push(TRELLOVIEW.renderChanges(this.changes(update_since)))
              return result.join("")
            },
            showLabels: TRELLOVIEW.showLabels,
            showChanges: TRELLOVIEW.showChanges,
            showUnchanged: TRELLOVIEW.showUnchanged,
            showFullChanges: TRELLOVIEW.showFullChanges,
          })
        }
      })
      if (TRELLOVIEW.reverse) {
        lists.reverse()
      }
      TRELLOVIEW.renderToTarget('lists', TRELLOVIEW.$content, {
        lists: lists,
        brief: brief
      })
    },

    displayFeature: function() {
      var feature = TRELLOVIEW.labels[TRELLOVIEW.featureId]
      console.log(feature)
      if (!feature) return

      TRELLOVIEW.renderToTarget('feature', TRELLOVIEW.$content, {
        feature: feature,
        lists: feature.lists()
      })
    },

    displayStatus: function() {
      var features = []
      if (TRELLOVIEW.labelTypes && TRELLOVIEW.labelTypes.Feature) {
        $.each(TRELLOVIEW.labelTypes.Feature.labels, function(index, feature) {
          if (feature.cards.cards.length) {
            features.push({
              id: feature.id,
              name: feature.name,
              color: feature.color,
              cardCount: feature.cards.cards.length,
              lists: feature.lists(),
            })
          }
        })
      }


      TRELLOVIEW.renderToTarget('status', TRELLOVIEW.$content, {
        features: features,
        boardId: TRELLOVIEW.boardId,
      })
    },

    printPrintable: function(target) {
      var $target = $(target.target),
          data = $target.data(),
          listId = data["listid"]
      if (listId === "ALL") {
        TRELLOVIEW.printAll()
      } else {
        TRELLOVIEW.printList(listId)
      }
    },

    printAll: function() {
      TRELLOVIEW.printCards(TRELLOVIEW.cards, "all")
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

      $.each(cardlist.filtered(TRELLOVIEW.update_since, TRELLOVIEW.major_updates, TRELLOVIEW.showUnchanged, TRELLOVIEW.featureId), function(index, card) {
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
