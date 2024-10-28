export type ArrayElement<ArrayType extends readonly unknown[]> = ArrayType extends readonly (infer ElementType)[]
    ? ElementType
    : never;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeText = (input: string) => textEncoder.encode(input.endsWith('\n') ? input : `${input}\n`);
export const encodeJSON = (input: unknown, pretty = false) =>
    encodeText(JSON.stringify(input, undefined, pretty ? 4 : undefined));

export const decodeText = (input: NodeJS.ArrayBufferView | ArrayBuffer): string => textDecoder.decode(input);
export const decodeJSON = (input: NodeJS.ArrayBufferView | ArrayBuffer): unknown => JSON.parse(decodeText(input));

export const FILE_EXTENSIONS_VERILOG = ['v', 'vh', 'sv', 'svh'];
export const FILE_EXTENSIONS_VHDL = ['vhd', 'vhdl'];
export const FILE_EXTENSIONS_HDL = [...FILE_EXTENSIONS_VERILOG, ...FILE_EXTENSIONS_VHDL];

export const formatArguments = (args: string[]) =>
    args.reduce(
        (prev, arg) =>
            arg.startsWith('--')
                ? [...prev, arg]
                : [...prev.slice(0, prev.length - 1), `${prev[prev.length - 1]} ${arg}`],
        [] as string[]
    );
