import type { TemplateCategory, TemplateMeta } from '../types/types';

export interface TemplateRegistryEntry {
    meta: TemplateMeta;
    relativePath: string;
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
    basic: 'Basic Digital Signals',
    logic: 'Logic Gates & Flip-Flops',
    bus: 'Bus Protocols',
    fsm: 'FSM State Machines',
    memory: 'Memory Access',
    pipeline: 'Pipeline',
    handshake: 'Handshake',
};

const CATEGORY_ORDER: TemplateCategory[] = [
    'basic', 'logic', 'bus', 'fsm', 'memory', 'pipeline', 'handshake',
];

export function getCategoryLabel(category: TemplateCategory): string {
    return CATEGORY_LABELS[category];
}

export function getCategoryOrder(): TemplateCategory[] {
    return [...CATEGORY_ORDER];
}

export const TEMPLATE_REGISTRY: TemplateRegistryEntry[] = [
    // Basic
    { meta: { name: 'Clock + Reset', category: 'basic', description: 'Clock with async/sync reset patterns', tags: ['clk', 'reset'] }, relativePath: 'basic/clock-reset.json' },
    { meta: { name: 'Clock Enable', category: 'basic', description: 'Clock with clock enable gating', tags: ['clk', 'enable'] }, relativePath: 'basic/clock-enable.json' },
    { meta: { name: 'Data Bus', category: 'basic', description: 'Address + data bus with valid signal', tags: ['data', 'bus'] }, relativePath: 'basic/data-bus.json' },
    { meta: { name: 'Interrupt', category: 'basic', description: 'Interrupt request and acknowledge', tags: ['irq', 'ack'] }, relativePath: 'basic/interrupt.json' },

    // Logic Gates & Flip-Flops
    { meta: { name: 'D Flip-Flop', category: 'logic', description: 'D flip-flop with setup/hold timing and async reset', tags: ['dff', 'flipflop'] }, relativePath: 'logic/d-flipflop.json' },
    { meta: { name: 'JK Flip-Flop', category: 'logic', description: 'JK flip-flop with toggle behavior', tags: ['jk', 'flipflop'] }, relativePath: 'logic/jk-flipflop.json' },
    { meta: { name: 'T Flip-Flop', category: 'logic', description: 'T (Toggle) flip-flop — frequency divider', tags: ['tff', 'flipflop'] }, relativePath: 'logic/t-flipflop.json' },
    { meta: { name: 'SR Latch', category: 'logic', description: 'SR latch (NOR-based) with set/reset', tags: ['sr', 'latch'] }, relativePath: 'logic/sr-latch.json' },
    { meta: { name: 'D Latch', category: 'logic', description: 'Level-sensitive D latch with enable', tags: ['latch', 'd'] }, relativePath: 'logic/d-latch.json' },
    { meta: { name: 'AND / OR / NOT', category: 'logic', description: 'Basic logic gates timing behavior', tags: ['and', 'or', 'not', 'gate'] }, relativePath: 'logic/and-or-not.json' },
    { meta: { name: 'NAND / NOR / XOR', category: 'logic', description: 'NAND, NOR, XOR, XNOR timing', tags: ['nand', 'nor', 'xor'] }, relativePath: 'logic/nand-nor-xor.json' },
    { meta: { name: 'MUX / DEMUX', category: 'logic', description: '2:1 Multiplexer and 1:2 Demultiplexer', tags: ['mux', 'demux'] }, relativePath: 'logic/mux-demux.json' },
    { meta: { name: 'Tri-State Buffer', category: 'logic', description: 'Tri-state buffer with output enable', tags: ['tristate', 'buffer'] }, relativePath: 'logic/tristate-buffer.json' },

    // Bus Protocols
    { meta: { name: 'AXI4 Write', category: 'bus', description: 'AXI4 AW + W + B channels', tags: ['axi', 'write'] }, relativePath: 'bus/axi4-write.json' },
    { meta: { name: 'AXI4 Read', category: 'bus', description: 'AXI4 AR + R channels', tags: ['axi', 'read'] }, relativePath: 'bus/axi4-read.json' },
    { meta: { name: 'AXI4-Lite', category: 'bus', description: 'AXI4-Lite simple read/write', tags: ['axi', 'lite'] }, relativePath: 'bus/axi4-lite.json' },
    { meta: { name: 'AHB Transfer', category: 'bus', description: 'AHB single and burst transfers', tags: ['ahb', 'amba'] }, relativePath: 'bus/ahb-transfer.json' },
    { meta: { name: 'SPI Transaction', category: 'bus', description: 'SPI Mode 0 full-duplex', tags: ['spi', 'serial'] }, relativePath: 'bus/spi-transaction.json' },
    { meta: { name: 'I2C Transaction', category: 'bus', description: 'I2C write with Start/Stop', tags: ['i2c', 'serial'] }, relativePath: 'bus/i2c-transaction.json' },
    { meta: { name: 'UART Frame', category: 'bus', description: 'UART 8N1 frame format', tags: ['uart', 'serial'] }, relativePath: 'bus/uart-frame.json' },

    // FSM
    { meta: { name: 'Simple FSM', category: 'fsm', description: 'IDLE → RUN → DONE 3-state', tags: ['fsm', 'simple'] }, relativePath: 'fsm/simple-fsm.json' },
    { meta: { name: 'Protocol FSM', category: 'fsm', description: 'REQ → GRANT → XFER → DONE', tags: ['fsm', 'protocol'] }, relativePath: 'fsm/protocol-fsm.json' },

    // Memory
    { meta: { name: 'SRAM Read', category: 'memory', description: 'Async SRAM read cycle', tags: ['sram', 'read'] }, relativePath: 'memory/sram-read.json' },
    { meta: { name: 'SRAM Write', category: 'memory', description: 'Async SRAM write cycle', tags: ['sram', 'write'] }, relativePath: 'memory/sram-write.json' },
    { meta: { name: 'DDR Burst', category: 'memory', description: 'DDR burst read (BL=4, CL=2)', tags: ['ddr', 'burst'] }, relativePath: 'memory/ddr-burst.json' },

    // Pipeline
    { meta: { name: '3-Stage Pipeline', category: 'pipeline', description: 'Fetch/Decode/Execute', tags: ['pipeline', '3-stage'] }, relativePath: 'pipeline/3stage-pipeline.json' },
    { meta: { name: 'Pipeline Stall', category: 'pipeline', description: 'Stall with bubble insertion', tags: ['pipeline', 'stall'] }, relativePath: 'pipeline/pipeline-stall.json' },
    { meta: { name: 'Pipeline Forwarding', category: 'pipeline', description: 'Data forwarding (bypass)', tags: ['pipeline', 'forward'] }, relativePath: 'pipeline/pipeline-forward.json' },

    // Handshake
    { meta: { name: 'Valid/Ready', category: 'handshake', description: 'AXI-Stream style handshake', tags: ['valid', 'ready'] }, relativePath: 'handshake/valid-ready.json' },
    { meta: { name: 'Req/Ack', category: 'handshake', description: '4-phase request/acknowledge', tags: ['req', 'ack'] }, relativePath: 'handshake/req-ack.json' },
    { meta: { name: 'Credit-Based', category: 'handshake', description: 'Credit-based flow control', tags: ['credit', 'flow'] }, relativePath: 'handshake/credit-based.json' },
];

export function getTemplatesByCategory(category: TemplateCategory): TemplateRegistryEntry[] {
    return TEMPLATE_REGISTRY.filter(t => t.meta.category === category);
}

export function searchTemplates(query: string): TemplateRegistryEntry[] {
    const lower = query.toLowerCase();
    return TEMPLATE_REGISTRY.filter(t =>
        t.meta.name.toLowerCase().includes(lower) ||
        t.meta.description.toLowerCase().includes(lower) ||
        t.meta.tags.some(tag => tag.includes(lower))
    );
}
