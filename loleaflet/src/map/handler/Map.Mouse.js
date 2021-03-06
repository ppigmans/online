/* -*- js-indent-level: 8 -*- */
/*
 * L.Map.Mouse is handling mouse interaction with the document
 */

L.Map.mergeOptions({
	mouse: true
});

L.Map.Mouse = L.Handler.extend({

	initialize: function (map) {
		this._map = map;
		this._mouseEventsQueue = [];
		this._prevMousePos = null;
	},

	addHooks: function () {
		this._map.on('mousedown mouseup mouseover mouseout mousemove dblclick trplclick qdrplclick',
			this._onMouseEvent, this);
	},

	removeHooks: function () {
		this._map.off('mousedown mouseup mouseover mouseout mousemove dblclick trplclick qdrplclick',
			this._onMouseEvent, this);
	},

	LOButtons: {
		left: 1,
		middle: 2,
		right: 4
	},

	JSButtons: {
		left: 0,
		middle: 1,
		right: 2
	},

	_onMouseEvent: function (e) {
		var docLayer = this._map._docLayer;
		if (!docLayer || (this._map.slideShow && this._map.slideShow.fullscreen) || this._map.rulerActive) {
			return;
		}
		if (docLayer._graphicMarker) {
			if (docLayer._graphicMarker.isDragged) {
				return;
			}
			if (!docLayer._isEmptyRectangle(docLayer._graphicSelection)) {
				// if we have a graphic selection and the user clicks inside the rectangle
				var isInside = docLayer._graphicMarker.getBounds().contains(e.latlng);
				if (e.type === 'mousedown' && isInside) {
					this._prevMousePos = e.latlng;
				}
				else if (e.type === 'mousemove' && this._mouseDown) {
					if (!this._prevMousePos && isInside) {
						// if the user started to drag the shape before the selection
						// has been drawn
						this._prevMousePos = e.latlng;
					}
					else {
						// we have a graphic selection and the user started to drag it
						var delta = L.latLng(e.latlng.lat - this._prevMousePos.lat, e.latlng.lng - this._prevMousePos.lng);
						this._prevMousePos = e.latlng;
						var oldSelectionCenter = docLayer._graphicMarker.getBounds().getCenter();
						var newSelectionCenter = L.latLng(oldSelectionCenter.lat + delta.lat, oldSelectionCenter.lng + delta.lng);
						if (docLayer._graphicMarker.editing) {
							docLayer._graphicMarker.editing._move(newSelectionCenter);
						}
					}
				}
				else if (e.type === 'mouseup') {
					this._prevMousePos = null;
				}
			}
		}

		for (var key in docLayer._selectionHandles) {
			if (docLayer._selectionHandles[key].isDragged) {
				return;
			}
		}

		var modifier = 0;
		var shift = e.originalEvent.shiftKey ? this._map.keyboard.keyModifier.shift : 0;
		var ctrl = e.originalEvent.ctrlKey ? this._map.keyboard.keyModifier.ctrl : 0;
		var alt = e.originalEvent.altKey ? this._map.keyboard.keyModifier.alt : 0;
		var cmd = e.originalEvent.metaKey ? this._map.keyboard.keyModifier.ctrlMac : 0;
		modifier = shift | ctrl | alt | cmd;

		var buttons = 0;
		buttons |= e.originalEvent.button === this.JSButtons.left ? this.LOButtons.left : 0;
		buttons |= e.originalEvent.button === this.JSButtons.middle ? this.LOButtons.middle : 0;
		buttons |= e.originalEvent.button === this.JSButtons.right ? this.LOButtons.right : 0;

		var mouseEnteringLeavingMap = this._map._mouseEnteringLeaving;

		if (mouseEnteringLeavingMap && e.type === 'mouseover' && this._mouseDown) {
			L.DomEvent.off(document, 'mousemove', this._onMouseMoveOutside, this);
			L.DomEvent.off(document, 'mouseup', this._onMouseUpOutside, this);
			L.DomEvent.off(this._map._resizeDetector.contentWindow, 'mousemove', this._onMouseMoveOutside, this);
			L.DomEvent.off(this._map._resizeDetector.contentWindow, 'mouseup', this._onMouseUpOutside, this);
		}
		else if (e.type === 'mousedown') {
			docLayer._resetPreFetching();
			this._mouseDown = true;
			if (this._holdMouseEvent) {
				clearTimeout(this._holdMouseEvent);
			}
			var mousePos = docLayer._latLngToTwips(e.latlng);
			this._mouseEventsQueue.push(L.bind(function() {
				this._postMouseEvent('buttondown', mousePos.x, mousePos.y, 1, buttons, modifier);
			}, docLayer));
			this._holdMouseEvent = setTimeout(L.bind(this._executeMouseEvents, this), 500);
		}
		else if (e.type === 'mouseup') {
			this._mouseDown = false;
			if (this._map.dragging.enabled()) {
				if (this._mouseEventsQueue.length === 0) {
					// mouse up after panning
					return;
				}
			}
			clearTimeout(this._holdMouseEvent);
			this._holdMouseEvent = null;
			if (this._clickTime && Date.now() - this._clickTime <= 250) {
				// double click, a click was sent already
				this._mouseEventsQueue = [];
				this._clickCount++;
				if (this._clickCount < 4) {
					// Reset the timer in order to keep resetting until
					// we could have sent through a quadruple click. After this revert
					// to normal behaviour so that a following single-click is treated
					// as a separate click, in order to match LO desktop behaviour.
					// (Clicking five times results in paragraph selection after 4 clicks,
					// followed by resetting to a single cursor and no selection on the
					// fifth click.)
					this._clickTime = Date.now();
				}
				return;
			}
			else {
				this._clickTime = Date.now();
				this._clickCount = 1;
				mousePos = docLayer._latLngToTwips(e.latlng);
				var timeOut = 250;
				if (this._map._permission === 'edit') {
					timeOut = 0;
				}
				this._mouseEventsQueue.push(L.bind(function() {
					var docLayer = this._map._docLayer;
					this._mouseEventsQueue = [];
					docLayer._postMouseEvent('buttonup', mousePos.x, mousePos.y, 1, buttons, modifier);
					this._map.focus();
				}, this));
				this._holdMouseEvent = setTimeout(L.bind(this._executeMouseEvents, this), timeOut);

				for (key in docLayer._selectionHandles) {
					var handle = docLayer._selectionHandles[key];
					if (handle._icon) {
						L.DomUtil.removeClass(handle._icon, 'leaflet-not-clickable');
					}
				}
			}

			this._map.fire('scrollvelocity', {vx: 0, vy: 0});
		}
		else if (e.type === 'mousemove' && this._mouseDown) {
			if (this._holdMouseEvent) {
				clearTimeout(this._holdMouseEvent);
				this._holdMouseEvent = null;
				if (this._map.dragging.enabled()) {
					// The user just panned the document
					this._mouseEventsQueue = [];
					return;
				}
				for (var i = 0; i < this._mouseEventsQueue.length; i++) {
					// synchronously execute old mouse events so we know that
					// they arrive to the server before the move command
					this._mouseEventsQueue[i]();
				}
				this._mouseEventsQueue = [];
			}
			if (!this._map.dragging.enabled()) {
				mousePos = docLayer._latLngToTwips(e.latlng);
				docLayer._postMouseEvent('move', mousePos.x, mousePos.y, 1, buttons, modifier);

				for (key in docLayer._selectionHandles) {
					handle = docLayer._selectionHandles[key];
					if (handle._icon) {
						L.DomUtil.addClass(handle._icon, 'leaflet-not-clickable');
					}
				}

				this._map.fire('handleautoscroll', {pos: e.containerPoint, map: this._map});
			}
		}
		else if (e.type === 'mousemove' && !this._mouseDown) {
			clearTimeout(this._mouseOverTimeout);
			mousePos = docLayer._latLngToTwips(e.latlng);
			this._mouseOverTimeout = setTimeout(L.bind(function() {
				docLayer._postMouseEvent('move', mousePos.x, mousePos.y, 1, 0, modifier);
			  }, this),
			  100);
		}
		else if (e.type === 'dblclick' || e.type === 'trplclick' || e.type === 'qdrplclick') {
			mousePos = docLayer._latLngToTwips(e.latlng);
			var clicks = {
				dblclick: 2,
				trplclick: 3,
				qdrplclick: 4
			};
			var count = clicks[e.type];

			docLayer._postMouseEvent('buttondown', mousePos.x, mousePos.y, count, buttons, modifier);
			docLayer._postMouseEvent('buttonup', mousePos.x, mousePos.y, count, buttons, modifier);
		}
		else if (mouseEnteringLeavingMap && e.type === 'mouseout' && this._mouseDown) {
			L.DomEvent.on(this._map._resizeDetector.contentWindow, 'mousemove', this._onMouseMoveOutside, this);
			L.DomEvent.on(this._map._resizeDetector.contentWindow, 'mouseup', this._onMouseUpOutside, this);
			L.DomEvent.on(document, 'mousemove', this._onMouseMoveOutside, this);
			L.DomEvent.on(document, 'mouseup', this._onMouseUpOutside, this);
		}
	},

	_executeMouseEvents: function () {
		this._holdMouseEvent = null;
		for (var i = 0; i < this._mouseEventsQueue.length; i++) {
			this._mouseEventsQueue[i]();
		}
		this._mouseEventsQueue = [];
	},

	_onMouseMoveOutside: function (e) {
		this._map._handleDOMEvent(e);
		if (this._map.dragging.enabled()) {
			this._map.dragging._draggable._onMove(e);
		}
	},

	_onMouseUpOutside: function (e) {
		this._mouseDown = false;
		L.DomEvent.off(document, 'mousemove', this._onMouseMoveOutside, this);
		L.DomEvent.off(document, 'mouseup', this._onMouseUpOutside, this);
		L.DomEvent.off(this._map._resizeDetector.contentWindow, 'mousemove', this._onMouseMoveOutside, this);
		L.DomEvent.off(this._map._resizeDetector.contentWindow, 'mouseup', this._onMouseUpOutside, this);

		this._map._handleDOMEvent(e);
		if (this._map.dragging.enabled()) {
			this._map.dragging._draggable._onUp(e);
		}
	}
});

L.Map.addInitHook('addHandler', 'mouse', L.Map.Mouse);
