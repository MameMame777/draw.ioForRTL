// Sample SystemVerilog with @wavedrom annotations
// Used for testing HDL → WaveDrom generation

module fifo #(
    parameter DATA_WIDTH = 8,
    parameter DEPTH = 16
)(
    // @wavedrom clk clk
    input  logic                    clk,

    // @wavedrom rst_n reset async active_low
    input  logic                    rst_n,

    // @wavedrom wr_en ctrl
    input  logic                    wr_en,

    // @wavedrom rd_en ctrl
    input  logic                    rd_en,

    // @wavedrom wdata data
    input  logic [DATA_WIDTH-1:0]   wdata,

    // @wavedrom rdata data
    output logic [DATA_WIDTH-1:0]   rdata,

    // @wavedrom full ctrl
    output logic                    full,

    // @wavedrom empty ctrl
    output logic                    empty
);

    // Internal signals
    localparam ADDR_WIDTH = $clog2(DEPTH);

    logic [ADDR_WIDTH:0] wr_ptr, rd_ptr;
    logic [DATA_WIDTH-1:0] mem [0:DEPTH-1];

    // @wavedrom state fsm states:IDLE,WRITE,READ,FULL
    typedef enum logic [1:0] {
        IDLE  = 2'b00,
        WRITE = 2'b01,
        READ  = 2'b10,
        FULL  = 2'b11
    } state_t;

    state_t state, next_state;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            state <= IDLE;
        else
            state <= next_state;
    end

    always_comb begin
        case (state)
            IDLE:  next_state = wr_en ? WRITE : (rd_en ? READ : IDLE);
            WRITE: next_state = full  ? FULL  : (wr_en ? WRITE : IDLE);
            READ:  next_state = empty ? IDLE  : (rd_en ? READ : IDLE);
            FULL:  next_state = rd_en ? READ  : FULL;
        endcase
    end

endmodule
