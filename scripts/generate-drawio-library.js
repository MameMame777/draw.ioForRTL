/**
 * Build script: Generate draw.io custom shape library from WaveDrom templates.
 * 
 * This script reads all WaveDrom template JSON files and renders them
 * to SVG using WaveDrom + onml, then packages them as a draw.io
 * custom library XML file (<mxlibrary>[...]</mxlibrary>).
 * 
 * Usage: node scripts/generate-drawio-library.js
 * Output: media/drawio-wavedrom-library.xml
 */

const fs = require('fs');
const path = require('path');

// Import WaveDrom and onml
let WaveDrom, onml;
try {
    WaveDrom = require('wavedrom');
    onml = require('onml');
} catch (e) {
    console.error('Install dependencies first: npm install');
    process.exit(1);
}

// Template registry (mirrors src/templates/index.ts)
const TEMPLATES = [
    { name: 'Clock + Reset',        category: 'basic',     file: 'basic/clock-reset.json' },
    { name: 'Clock Enable',         category: 'basic',     file: 'basic/clock-enable.json' },
    { name: 'Data Bus',             category: 'basic',     file: 'basic/data-bus.json' },
    { name: 'Interrupt',            category: 'basic',     file: 'basic/interrupt.json' },
    { name: 'D Flip-Flop',          category: 'logic',     file: 'logic/d-flipflop.json' },
    { name: 'JK Flip-Flop',         category: 'logic',     file: 'logic/jk-flipflop.json' },
    { name: 'T Flip-Flop',          category: 'logic',     file: 'logic/t-flipflop.json' },
    { name: 'SR Latch',             category: 'logic',     file: 'logic/sr-latch.json' },
    { name: 'D Latch',              category: 'logic',     file: 'logic/d-latch.json' },
    { name: 'AND / OR / NOT',       category: 'logic',     file: 'logic/and-or-not.json' },
    { name: 'NAND / NOR / XOR',     category: 'logic',     file: 'logic/nand-nor-xor.json' },
    { name: 'MUX / DEMUX',          category: 'logic',     file: 'logic/mux-demux.json' },
    { name: 'Tri-State Buffer',     category: 'logic',     file: 'logic/tristate-buffer.json' },
    { name: 'AXI4 Write',           category: 'bus',       file: 'bus/axi4-write.json' },
    { name: 'AXI4 Read',            category: 'bus',       file: 'bus/axi4-read.json' },
    { name: 'AXI4-Lite',            category: 'bus',       file: 'bus/axi4-lite.json' },
    { name: 'AHB Transfer',         category: 'bus',       file: 'bus/ahb-transfer.json' },
    { name: 'SPI Transaction',      category: 'bus',       file: 'bus/spi-transaction.json' },
    { name: 'I2C Transaction',      category: 'bus',       file: 'bus/i2c-transaction.json' },
    { name: 'UART Frame',           category: 'bus',       file: 'bus/uart-frame.json' },
    { name: 'Simple FSM',           category: 'fsm',       file: 'fsm/simple-fsm.json' },
    { name: 'Protocol FSM',         category: 'fsm',       file: 'fsm/protocol-fsm.json' },
    { name: 'SRAM Read',            category: 'memory',    file: 'memory/sram-read.json' },
    { name: 'SRAM Write',           category: 'memory',    file: 'memory/sram-write.json' },
    { name: 'DDR Burst',            category: 'memory',    file: 'memory/ddr-burst.json' },
    { name: '3-Stage Pipeline',     category: 'pipeline',  file: 'pipeline/3stage-pipeline.json' },
    { name: 'Pipeline Stall',       category: 'pipeline',  file: 'pipeline/pipeline-stall.json' },
    { name: 'Pipeline Forwarding',  category: 'pipeline',  file: 'pipeline/pipeline-forward.json' },
    { name: 'Valid/Ready',          category: 'handshake', file: 'handshake/valid-ready.json' },
    { name: 'Req/Ack',             category: 'handshake', file: 'handshake/req-ack.json' },
    { name: 'Credit-Based',        category: 'handshake', file: 'handshake/credit-based.json' },
];

const CATEGORY_LABELS = {
    basic:     'Basic Digital',
    logic:     'Logic Gates & FF',
    bus:       'Bus Protocols',
    fsm:       'FSM',
    memory:    'Memory',
    pipeline:  'Pipeline',
    handshake: 'Handshake',
    truthtable: 'Truth Table',
};

// ---------------------------------------------------------------
// Truth table definitions to include in the library
// ---------------------------------------------------------------
const TRUTH_TABLES = [
    {
        name: 'AND Gate',
        inputs: ['A', 'B'],
        outputs: [{ name: 'Y', expression: 'A & B' }],
    },
    {
        name: 'OR Gate',
        inputs: ['A', 'B'],
        outputs: [{ name: 'Y', expression: 'A | B' }],
    },
    {
        name: 'XOR Gate',
        inputs: ['A', 'B'],
        outputs: [{ name: 'Y', expression: 'A ^ B' }],
    },
    {
        name: 'NAND Gate',
        inputs: ['A', 'B'],
        outputs: [{ name: 'Y', expression: '~(A & B)' }],
    },
    {
        name: 'NOR Gate',
        inputs: ['A', 'B'],
        outputs: [{ name: 'Y', expression: '~(A | B)' }],
    },
    {
        name: 'Half Adder',
        inputs: ['A', 'B'],
        outputs: [
            { name: 'S', expression: 'A ^ B' },
            { name: 'C', expression: 'A & B' },
        ],
    },
    {
        name: '2-to-1 MUX',
        inputs: ['S', 'A', 'B'],
        outputs: [{ name: 'Y', expression: '(~S & A) | (S & B)' }],
    },
    {
        name: '3-Input Majority',
        inputs: ['A', 'B', 'C'],
        outputs: [{ name: 'Y', expression: '(A & B) | (A & C) | (B & C)' }],
    },
];

function renderTemplate(templateData) {
    const source = { ...templateData };
    delete source.meta;

    try {
        const svgArray = WaveDrom.renderAny(0, source, WaveDrom.waveSkin);
        let svgStr = onml.stringify(svgArray);
        // Extract viewBox or width/height (rough parse)
        const widthMatch = svgStr.match(/width="?(\d+)/);
        const heightMatch = svgStr.match(/height="?(\d+)/);
        const w = widthMatch ? parseInt(widthMatch[1]) : 400;
        const h = heightMatch ? parseInt(heightMatch[1]) : 200;

        // Add white background rect so thumbnails are visible in draw.io sidebar
        svgStr = svgStr.replace(
            /(<svg[^>]*>)/,
            '$1<rect width="100%" height="100%" fill="#ffffff"/>'
        );

        return { svg: svgStr, width: w, height: h };
    } catch (e) {
        console.warn(`  Warning: Failed to render:`, e.message);
        return null;
    }
}

function buildLibraryEntry(name, category, svgStr, width, height, wavedromJson) {
    // Use a native draw.io rounded rectangle with text label as sidebar thumbnail.
    // This guarantees visibility in the sidebar (image data URIs don't render there).
    // The draw.io plugin auto-renders WaveDrom SVG when the cell is dropped on canvas.
    const label = escapeXml(name);
    const catLabel = escapeXml(CATEGORY_LABELS[category] || category);
    const thumbW = 160;
    const thumbH = 60;

    const style = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;' +
        'fontSize=11;fontFamily=Arial;fontStyle=1;verticalAlign=middle;';

    // IMPORTANT: Use <object> (UserObject) to preserve custom attributes like wavedromJson.
    // Bare attributes on <mxCell> are lost during draw.io codec deserialization.
    // HTML tags in XML attributes MUST be entity-escaped: <br> → &lt;br&gt;
    // Also avoids </ sequences that break <script> blocks in the webview.
    const htmlLabel = label + '&lt;br&gt;&lt;font style=&quot;font-size:9px;font-weight:normal;color:#6c8ebf;&quot;&gt;' + catLabel + '&lt;/font&gt;';
    const xml =
        '<mxGraphModel>' +
        '<root>' +
        '<mxCell id="0"/>' +
        '<mxCell id="1" parent="0"/>' +
        '<object label="' + htmlLabel + '" ' +
        'wavedromJson="' + escapeXml(JSON.stringify(wavedromJson)) + '" id="2">' +
        '<mxCell style="' + escapeXml(style) + '" ' +
        'vertex="1" parent="1">' +
        '<mxGeometry width="' + thumbW + '" height="' + thumbH + '" as="geometry"/>' +
        '</mxCell>' +
        '</object>' +
        '</root>' +
        '</mxGraphModel>';

    return {
        xml: xml,
        w: thumbW,
        h: thumbH,
        title: `[${catLabel}] ${name}`,
        aspect: 'fixed',
    };
}

function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function main() {
    const templatesDir = path.join(__dirname, '..', 'src', 'templates');
    const outputFile = path.join(__dirname, '..', 'media', 'drawio-wavedrom-library.xml');

    const libraryEntries = [];
    let successCount = 0;
    let failCount = 0;

    console.log('Generating draw.io custom shape library...');
    console.log(`Templates dir: ${templatesDir}`);

    for (const tmpl of TEMPLATES) {
        const filePath = path.join(templatesDir, tmpl.file);
        process.stdout.write(`  Processing ${tmpl.name}...`);

        if (!fs.existsSync(filePath)) {
            console.log(' SKIP (file not found)');
            failCount++;
            continue;
        }

        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const result = renderTemplate(data);

            if (result && result.svg) {
                const wavedromJson = { ...data };
                delete wavedromJson.meta;

                const entry = buildLibraryEntry(
                    tmpl.name,
                    tmpl.category,
                    result.svg,
                    result.width,
                    result.height,
                    wavedromJson
                );
                libraryEntries.push(entry);
                console.log(` OK (${result.width}x${result.height})`);
                successCount++;
            } else {
                console.log(' FAIL (render returned null)');
                failCount++;
            }
        } catch (e) {
            console.log(` FAIL (${e.message})`);
            failCount++;
        }
    }

    // ----- Truth Table Shapes -----
    console.log('\nGenerating truth table shapes...');
    let TruthTableGenerator, TruthTableRenderer;
    try {
        TruthTableGenerator = require('../out/truthTable/TruthTableGenerator').TruthTableGenerator;
        TruthTableRenderer = require('../out/truthTable/TruthTableRenderer').TruthTableRenderer;
    } catch (e) {
        console.warn('  Warning: Could not load TruthTable modules. Run `npm run compile` first.');
        console.warn('  Skipping truth table shapes.');
    }

    if (TruthTableGenerator && TruthTableRenderer) {
        const renderer = new TruthTableRenderer();
        for (const ttDef of TRUTH_TABLES) {
            process.stdout.write(`  Processing ${ttDef.name}...`);
            try {
                const table = TruthTableGenerator.generate(ttDef.inputs, ttDef.outputs);
                const xml = renderer.renderToDrawioXml(table);

                // Parse dimensions from the XML (look for the group cell geometry)
                const geoMatch = xml.match(/id="100"[^>]*>.*?width="(\d+)"\s+height="(\d+)"/s);
                const w = geoMatch ? parseInt(geoMatch[1]) : 240;
                const h = geoMatch ? parseInt(geoMatch[2]) : 200;

                const entry = {
                    xml: xml,
                    w: w,
                    h: h,
                    title: '[Truth Table] ' + ttDef.name,
                    aspect: 'fixed',
                };
                libraryEntries.push(entry);
                console.log(` OK (${w}x${h})`);
                successCount++;
            } catch (e) {
                console.log(` FAIL (${e.message})`);
                failCount++;
            }
        }
    }

    // Build the mxlibrary XML
    const libraryJson = JSON.stringify(libraryEntries);
    const libraryXml = '<mxlibrary>' + libraryJson + '</mxlibrary>';

    fs.writeFileSync(outputFile, libraryXml, 'utf-8');

    console.log(`\nDone! ${successCount} succeeded, ${failCount} failed.`);
    console.log(`Output: ${outputFile}`);
    console.log(`Size: ${(Buffer.byteLength(libraryXml) / 1024).toFixed(1)} KB`);
}

main();
