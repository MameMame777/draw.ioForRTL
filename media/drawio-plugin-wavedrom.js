/**
 * DrawWave draw.io Plugin — adds WaveDrom integration inside draw.io
 * 
 * Features:
 * - Toolbar button "WaveDrom" to open JSON editor dialog
 * - JSON → SVG rendering inside draw.io (uses bundled WaveDrom)
 * - Edit existing WaveDrom shapes by double-clicking
 * - WaveDrom template library in sidebar
 * 
 * This file is loaded as a draw.io plugin via the plugin mechanism.
 * It expects WaveDrom to be available globally (loaded before this script).
 */

(function bootstrapDrawWavePlugin() {
    'use strict';

    function registerWhenReady() {
        if (typeof Draw === 'undefined' || !Draw.loadPlugin) {
            setTimeout(registerWhenReady, 50);
            return;
        }

        Draw.loadPlugin(function(ui) {
    'use strict';

    // ---------------------------------------------------------------
    // WaveDrom rendering helper
    // ---------------------------------------------------------------
    function renderWaveDromSvg(source) {
        if (typeof WaveDrom === 'undefined') {
            throw new Error('WaveDrom library not loaded');
        }
        // Create a temporary container for rendering
        var container = document.createElement('div');
        container.id = 'wavedrom_plugin_' + Date.now();
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        document.body.appendChild(container);

        var script = document.createElement('script');
        script.type = 'WaveDrom';
        script.textContent = JSON.stringify(source);
        container.appendChild(script);

        try {
            WaveDrom.ProcessAll();
        } catch (e) {
            document.body.removeChild(container);
            throw e;
        }

        var svgEl = container.querySelector('svg');
        var svgStr = '';
        var width = 400;
        var height = 200;
        if (svgEl) {
            svgStr = new XMLSerializer().serializeToString(svgEl);
            width = Math.max(svgEl.getAttribute('width') || svgEl.viewBox.baseVal.width || 400, 100);
            height = Math.max(svgEl.getAttribute('height') || svgEl.viewBox.baseVal.height || 200, 50);
        }
        document.body.removeChild(container);
        return { svg: svgStr, width: width, height: height };
    }

    // ---------------------------------------------------------------
    // Insert WaveDrom shape into the graph
    // ---------------------------------------------------------------
    function insertWaveDromShape(graph, source, x, y) {
        var result = renderWaveDromSvg(source);
        if (!result.svg) {
            mxUtils.alert('WaveDrom render failed');
            return;
        }

        // Use URL-encoded SVG (not base64) to avoid semicolons that break
        // draw.io's style parser which splits on ';'.
        var dataUri = 'data:image/svg+xml,' + encodeURIComponent(result.svg);

        var model = graph.getModel();
        model.beginUpdate();
        try {
            // Use UserObject to reliably store custom attributes
            var doc = mxUtils.createXmlDocument();
            var obj = doc.createElement('object');
            obj.setAttribute('wavedromJson', JSON.stringify(source));
            obj.setAttribute('label', '');

            var cell = new mxCell(
                obj,
                new mxGeometry(x || 100, y || 100, result.width, result.height),
                'shape=image;image=' + dataUri +
                ';imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;' +
                'verticalAlign=top;'
            );
            cell.vertex = true;

            graph.addCell(cell);
            graph.setSelectionCell(cell);
        } finally {
            model.endUpdate();
        }
    }

    // ---------------------------------------------------------------
    // WaveDrom JSON Editor Dialog
    // ---------------------------------------------------------------
    function showWaveDromDialog(graph, existingJson, existingCell) {
        var defaultJson = existingJson || JSON.stringify({
            signal: [
                { name: 'clk', wave: 'p......' },
                { name: 'data', wave: 'x.=.=.x', data: ['D0', 'D1'] },
                { name: 'valid', wave: '0.1..0.' }
            ]
        }, null, 2);

        // Create dialog container — flexbox so buttons stay at the bottom
        var div = document.createElement('div');
        div.style.cssText =
            'display: flex; flex-direction: column; height: 100%; padding: 0; overflow: hidden;';

        // Preview area (shrinkable)
        var previewDiv = document.createElement('div');
        previewDiv.style.cssText =
            'border: 1px solid #ccc; background: #fff; min-height: 80px; flex: 0 1 auto; ' +
            'padding: 8px; margin-bottom: 8px; overflow: auto; max-height: 220px;';
        previewDiv.id = 'wavedrom-preview-' + Date.now();
        div.appendChild(previewDiv);

        // JSON editor textarea (fills remaining space)
        var textarea = document.createElement('textarea');
        textarea.style.cssText =
            'width: 100%; flex: 1 1 150px; min-height: 100px; ' +
            'font-family: "Cascadia Code", "Consolas", monospace; ' +
            'font-size: 12px; border: 1px solid #ccc; padding: 8px; box-sizing: border-box; ' +
            'resize: none; tab-size: 2;';
        textarea.value = defaultJson;
        textarea.spellcheck = false;
        div.appendChild(textarea);

        // Error message area
        var errorDiv = document.createElement('div');
        errorDiv.style.cssText =
            'color: #d32f2f; font-size: 12px; margin-top: 4px; min-height: 18px; flex: 0 0 auto;';
        div.appendChild(errorDiv);

        // Live preview update function
        var previewTimeout = null;
        function updatePreview() {
            try {
                var source = JSON.parse(textarea.value);
                // Remove meta if present
                delete source.meta;
                var result = renderWaveDromSvg(source);
                previewDiv.innerHTML = result.svg;
                errorDiv.textContent = '';
                return source;
            } catch (e) {
                errorDiv.textContent = 'Error: ' + e.message;
                return null;
            }
        }

        textarea.addEventListener('input', function() {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(updatePreview, 300);
        });

        // Tab key support in textarea
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Tab') {
                e.preventDefault();
                var start = this.selectionStart;
                var end = this.selectionEnd;
                this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
                this.selectionStart = this.selectionEnd = start + 2;
            }
        });

        // Initial preview render
        setTimeout(updatePreview, 100);

        // Button bar — flex-shrink: 0 keeps it always visible at the bottom
        var btnBar = document.createElement('div');
        btnBar.style.cssText = 'flex: 0 0 auto; padding: 8px 0 4px 0; text-align: left;';

        var okBtn = document.createElement('button');
        okBtn.textContent = existingCell ? 'Update' : 'Insert';
        okBtn.style.cssText =
            'margin-right: 8px; padding: 6px 20px; background: #0078d4; color: #fff; ' +
            'border: none; border-radius: 3px; cursor: pointer; font-size: 13px;';
        btnBar.appendChild(okBtn);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText =
            'padding: 6px 20px; background: #e0e0e0; color: #333; ' +
            'border: none; border-radius: 3px; cursor: pointer; font-size: 13px;';
        btnBar.appendChild(cancelBtn);
        div.appendChild(btnBar);

        // Create and show dialog
        var dlg = new mxWindow(
            existingCell ? 'Edit WaveDrom' : 'Insert WaveDrom',
            div,
            (document.body.clientWidth - 560) / 2,
            Math.max(40, (document.body.clientHeight - 580) / 2),
            540,
            540,
            true,  // minimizable
            true   // movable
        );

        dlg.setClosable(true);
        dlg.setResizable(true);
        dlg.setVisible(true);

        okBtn.addEventListener('click', function() {
            var source = updatePreview();
            if (!source) return;

            if (existingCell) {
                updateWaveDromCell(graph, existingCell, source);
            } else {
                insertWaveDromShape(graph, source);
            }
            dlg.destroy();
        });

        cancelBtn.addEventListener('click', function() {
            dlg.destroy();
        });

        textarea.focus();
    }

    // ---------------------------------------------------------------
    // Update existing WaveDrom cell
    // ---------------------------------------------------------------
    function updateWaveDromCell(graph, cell, source) {
        var result = renderWaveDromSvg(source);
        if (!result.svg) return;

        // Use URL-encoded SVG (not base64) to avoid semicolons that break
        // draw.io's style parser which splits on ';'.
        var dataUri = 'data:image/svg+xml,' + encodeURIComponent(result.svg);

        var model = graph.getModel();
        model.beginUpdate();
        try {
            var style = 'shape=image;image=' + dataUri +
                ';imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;';
            graph.setCellStyle(style, [cell]);

            // Store WaveDrom JSON — handle both plain cells and UserObject cells
            var jsonStr = JSON.stringify(source);
            if (cell.value && cell.value.nodeType === 1) {
                // UserObject (XML element): set attribute on the element
                cell.value.setAttribute('wavedromJson', jsonStr);
                cell.value.setAttribute('label', '');
            } else {
                // Plain cell: convert to UserObject
                var doc = mxUtils.createXmlDocument();
                var obj = doc.createElement('object');
                obj.setAttribute('wavedromJson', jsonStr);
                obj.setAttribute('label', '');
                cell.setValue(obj);
            }

            // Update geometry if size changed
            var geo = cell.getGeometry().clone();
            geo.width = result.width;
            geo.height = result.height;
            model.setGeometry(cell, geo);
        } finally {
            model.endUpdate();
        }
    }

    // ---------------------------------------------------------------
    // Register toolbar button
    // ---------------------------------------------------------------
    var graph = ui.editor.graph;

    // Add WaveDrom action
    ui.actions.addAction('insertWaveDrom', function() {
        showWaveDromDialog(graph, null, null);
    });

    // Add menu item under "Edit" or "Extras"
    try {
        var menu = ui.menus.get('extras');
        if (menu) {
            var oldFunct = menu.funct;
            menu.funct = function(menuObj, parent) {
                oldFunct.apply(this, arguments);
                menuObj.addSeparator(parent);
                ui.menus.addMenuItem(menuObj, 'insertWaveDrom', parent);
            };
        }
    } catch (e) {
        console.log('DrawWave: Could not add menu item', e);
    }

    // Add toolbar button
    try {
        var toolbar = document.querySelector('.geToolbar, .geDiagramContainer');
        if (ui.toolbar) {
            ui.toolbar.addSeparator();
            var btn = ui.toolbar.addItem('', 'insertWaveDrom');
            if (btn) {
                btn.setAttribute('title', 'Insert WaveDrom Diagram');
                btn.innerHTML =
                    '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle">' +
                    '<path fill="currentColor" d="M3 17h2v-4h2v4h2V9h2v8h2v-6h2v6h2V7h2v10h1v2H2v-2h1z"/>' +
                    '</svg>';
            }

            // --- DrawWave feature buttons ---
            ui.toolbar.addSeparator();

            // Module Port Diagram button
            ui.actions.addAction('drawwaveModulePort', function() {
                if (window.__drawwave_vscode) {
                    window.__drawwave_vscode.postMessage({ type: 'command', command: 'drawwave.modulePortDiagram' });
                }
            });
            var portBtn = ui.toolbar.addItem('', 'drawwaveModulePort');
            if (portBtn) {
                portBtn.setAttribute('title', 'Module Port Diagram');
                portBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle">' +
                    '<path fill="currentColor" d="M4 4h16v16H4V4zm2 2v12h12V6H6zm1 2h4v2H7V8zm6 0h4v2h-4V8zM7 12h4v2H7v-2zm6 0h4v2h-4v-2z"/>' +
                    '</svg>';
            }

            // FSM Diagram button
            ui.actions.addAction('drawwaveFsm', function() {
                if (window.__drawwave_vscode) {
                    window.__drawwave_vscode.postMessage({ type: 'command', command: 'drawwave.fsmDiagram' });
                }
            });
            var fsmBtn = ui.toolbar.addItem('', 'drawwaveFsm');
            if (fsmBtn) {
                fsmBtn.setAttribute('title', 'FSM State Transition Diagram');
                fsmBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle">' +
                    '<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14c-2.67 0-5.02-1.37-6.39-3.44C7.02 13.73 9.69 13 12 13s4.98.73 6.39 2.56C17.02 17.63 14.67 19 12 19z"/>' +
                    '</svg>';
            }

            // VCD Import button
            ui.actions.addAction('drawwaveVcd', function() {
                if (window.__drawwave_vscode) {
                    window.__drawwave_vscode.postMessage({ type: 'command', command: 'drawwave.importVcd' });
                }
            });
            var vcdBtn = ui.toolbar.addItem('', 'drawwaveVcd');
            if (vcdBtn) {
                vcdBtn.setAttribute('title', 'Import VCD Waveform');
                vcdBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle">' +
                    '<path fill="currentColor" d="M3.5 18.5l6-6 4 4L22 6.92 20.59 5.5l-7.09 8.07-4-4L2 17h1.5z"/>' +
                    '</svg>';
            }

            // HDL → WaveDrom button
            ui.actions.addAction('drawwaveHdl', function() {
                if (window.__drawwave_vscode) {
                    window.__drawwave_vscode.postMessage({ type: 'command', command: 'drawwave.hdlToDrawio' });
                }
            });
            var hdlBtn = ui.toolbar.addItem('', 'drawwaveHdl');
            if (hdlBtn) {
                hdlBtn.setAttribute('title', 'HDL → WaveDrom to Diagram');
                hdlBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle">' +
                    '<path fill="currentColor" d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>' +
                    '</svg>';
            }

            // Module Hierarchy Diagram button
            ui.actions.addAction('drawwaveHierarchy', function() {
                if (window.__drawwave_vscode) {
                    window.__drawwave_vscode.postMessage({ type: 'command', command: 'drawwave.moduleHierarchy' });
                }
            });
            var hierBtn = ui.toolbar.addItem('', 'drawwaveHierarchy');
            if (hierBtn) {
                hierBtn.setAttribute('title', 'Module Hierarchy Diagram');
                hierBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle">' +
                    '<path fill="currentColor" d="M3 3h8v4H3V3zm10 0h8v4h-8V3zm-2 6h4v2h-4V9zM5 7v4H3V7h2zm16 0v4h-2V7h2zM3 13h8v4H3v-4zm10 0h8v4h-8v-4zM7 17v2H3v-2h4zm14 0v2h-4v-2h4zM1 21h8v2H1v-2zm14 0h8v2h-8v-2z"/>' +
                    '</svg>';
            }

            // --- Truth Table CSV Import/Export buttons ---
            ui.toolbar.addSeparator();

            // Import Truth Table (CSV/Markdown) button
            ui.actions.addAction('drawwaveImportTruthTable', function() {
                if (window.__drawwave_vscode) {
                    window.__drawwave_vscode.postMessage({ type: 'command', command: 'drawwave.importTruthTable' });
                }
            });
            var importBtn = ui.toolbar.addItem('', 'drawwaveImportTruthTable');
            if (importBtn) {
                importBtn.setAttribute('title', 'Import Truth Table (CSV/Markdown)');
                importBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle">' +
                    '<path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM7 13h3v-2H7v2zm0 4h10v-2H7v2zm0-8h2V7H7v2z"/>' +
                    '</svg>';
            }
        }
    } catch (e) {
        console.log('DrawWave: Could not add toolbar button', e);
    }

    // ---------------------------------------------------------------
    // Double-click to edit WaveDrom shapes
    // ---------------------------------------------------------------
    graph.addListener(mxEvent.DOUBLE_CLICK, function(sender, evt) {
        var cell = evt.getProperty('cell');
        if (cell && cell.getAttribute && cell.getAttribute('wavedromJson')) {
            evt.consume();
            var json = cell.getAttribute('wavedromJson');
            try {
                var formatted = JSON.stringify(JSON.parse(json), null, 2);
                showWaveDromDialog(graph, formatted, cell);
            } catch (e) {
                showWaveDromDialog(graph, json, cell);
            }
        }
        // Open HDL source file on double-click (for hierarchy diagram blocks)
        if (cell && cell.getAttribute && cell.getAttribute('hdlFilePath') && !cell.getAttribute('wavedromJson')) {
            var filePath = cell.getAttribute('hdlFilePath');
            // Only open file if there is no page link (leaf modules)
            // or if there IS a page link, let draw.io handle the link navigation
            var link = cell.getAttribute('link');
            if (!link || !link.match(/^data:page\//)) {
                evt.consume();
                if (window.__drawwave_vscode) {
                    window.__drawwave_vscode.postMessage({ type: 'open-file', filePath: filePath });
                }
            }
        }
    });

    // ---------------------------------------------------------------
    // Auto-render WaveDrom cells dropped from the sidebar library
    // When a cell with wavedromJson attribute is added to the graph,
    // render the actual WaveDrom SVG and update the cell style.
    //
    // Strategy: Listen to model changes and look at ALL changes for
    // any cell that has a wavedromJson attribute but is still a
    // placeholder rectangle (not yet rendered to SVG image).
    // ---------------------------------------------------------------
    graph.getModel().addListener(mxEvent.CHANGE, function(sender, evt) {
        var edit = evt.getProperty('edit');
        if (!edit || !edit.changes) return;
        var changes = edit.changes;
        var toRender = [];
        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];
            // Look for child additions — check both change.child and change.cell
            var cell = change.child || change.cell;
            if (!cell) continue;
            // Check if this cell or its value (UserObject) carries wavedromJson
            var wavedromAttr = null;
            if (cell.getAttribute && typeof cell.getAttribute === 'function') {
                try { wavedromAttr = cell.getAttribute('wavedromJson'); } catch(e) {}
            }
            if (!wavedromAttr && cell.value && cell.value.getAttribute) {
                try { wavedromAttr = cell.value.getAttribute('wavedromJson'); } catch(e) {}
            }
            if (wavedromAttr) {
                // Only render if cell still has placeholder style (not already an image)
                var style = '';
                if (cell.getStyle) { style = cell.getStyle() || ''; }
                else if (cell.style) { style = cell.style || ''; }
                if (style.indexOf('shape=image') === -1) {
                    toRender.push(cell);
                }
            }
        }
        if (toRender.length > 0) {
            setTimeout(function() {
                for (var j = 0; j < toRender.length; j++) {
                    try {
                        var c = toRender[j];
                        var attr = null;
                        if (c.getAttribute && typeof c.getAttribute === 'function') {
                            try { attr = c.getAttribute('wavedromJson'); } catch(e) {}
                        }
                        if (!attr && c.value && c.value.getAttribute) {
                            try { attr = c.value.getAttribute('wavedromJson'); } catch(e) {}
                        }
                        if (attr) {
                            var source = JSON.parse(attr);
                            updateWaveDromCell(graph, c, source);
                        }
                    } catch (e) {
                        console.log('DrawWave: Auto-render failed', e);
                    }
                }
            }, 300);
        }
    });

    // ---------------------------------------------------------------
    // Context menu for WaveDrom shapes
    // ---------------------------------------------------------------
    var originalPopupMenu = ui.menus.createPopupMenu;
    ui.menus.createPopupMenu = function(menu, cell, evt) {
        originalPopupMenu.apply(this, arguments);

        if (cell && cell.getAttribute && cell.getAttribute('wavedromJson')) {
            menu.addSeparator();
            menu.addItem('Edit WaveDrom JSON', null, function() {
                var json = cell.getAttribute('wavedromJson');
                try {
                    var formatted = JSON.stringify(JSON.parse(json), null, 2);
                    showWaveDromDialog(graph, formatted, cell);
                } catch (e) {
                    showWaveDromDialog(graph, json, cell);
                }
            });
        }

        // "Set File Link..." — open VS Code file picker and set link on cell
        if (cell) {
            menu.addSeparator();
            menu.addItem('Set File Link...', null, function() {
                if (!window.__drawwave_vscode) { return; }

                // Register callback for when VS Code returns the picked file
                window.__drawwave_onFilePicked = function(filePath) {
                    window.__drawwave_onFilePicked = null;
                    if (!filePath) { return; }

                    var model = graph.getModel();
                    model.beginUpdate();
                    try {
                        // Convert mxCell to UserObject if needed
                        var value = model.getValue(cell);
                        if (!value || typeof value === 'string') {
                            var doc = mxUtils.createXmlDocument();
                            var obj = doc.createElement('UserObject');
                            obj.setAttribute('label', value || '');
                            model.setValue(cell, obj);
                            value = obj;
                        }
                        if (value.setAttribute) {
                            value.setAttribute('link', filePath);
                            value.setAttribute('hdlFilePath', filePath);
                        }
                    } finally {
                        model.endUpdate();
                    }
                };

                // Ask VS Code to show file picker
                window.__drawwave_vscode.postMessage({ type: 'pick-file-link' });
            });

            // "Open Source File" for cells that already have hdlFilePath
            if (cell.getAttribute && cell.getAttribute('hdlFilePath')) {
                menu.addItem('Open Source File', null, function() {
                    if (window.__drawwave_vscode) {
                        window.__drawwave_vscode.postMessage({
                            type: 'open-file',
                            filePath: cell.getAttribute('hdlFilePath')
                        });
                    }
                });
            }
        }
    };

    // ---------------------------------------------------------------
    // File link handling — open local file paths in VS Code
    // ---------------------------------------------------------------
    var origIsCustomLink = graph.isCustomLink;
    graph.isCustomLink = function(href) {
        if (origIsCustomLink.apply(this, arguments)) { return true; }
        // Treat non-URL strings as file paths (custom links)
        if (href && !href.match(/^(https?:|mailto:|tel:|javascript:)/i)) {
            return true;
        }
        return false;
    };

    var origCustomLinkClicked = graph.customLinkClicked;
    graph.customLinkClicked = function(href) {
        // File path — send to VS Code to open
        if (href && !href.match(/^(https?:|mailto:|tel:|data:|javascript:)/i)) {
            if (window.__drawwave_vscode) {
                window.__drawwave_vscode.postMessage({ type: 'open-file', filePath: href });
            }
            return;
        }
        return origCustomLinkClicked.apply(this, arguments);
    };

    // ---------------------------------------------------------------
    // Notify host (postMessage to VSCode) that plugin is ready
    // ---------------------------------------------------------------
    try {
        // In offline mode, draw.io runs directly in the webview
        // with window.opener faked by the extension host.
        if (window.opener && window.opener.postMessage) {
            window.opener.postMessage(JSON.stringify({
                event: 'pluginLoaded',
                plugin: 'drawwave-wavedrom'
            }), '*');
        } else if (window.parent && window.parent !== window) {
            // Online mode — iframe inside webview
            window.parent.postMessage(JSON.stringify({
                event: 'pluginLoaded',
                plugin: 'drawwave-wavedrom'
            }), '*');
        }
    } catch (e) {
        // ignore if cross-origin
    }

    console.log('DrawWave WaveDrom plugin loaded');
        });
    }

    registerWhenReady();
})();
