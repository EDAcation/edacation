import path from 'path';

import {FILE_EXTENSIONS_HDL, FILE_EXTENSIONS_VERILOG} from '../util.js';

import type {ProjectConfiguration, YosysOptions} from './configuration.js';
import {VENDORS, type Vendor} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getOptions, getTarget, getTargetFile} from './target.js';

export interface YosysWorkerOptions {
    inputFiles: string[];
    outputFiles: string[];
    tool: string;
    commands: string[];
}

interface YosysRTLOutputFiles {
    stats: string;
    rtl: string;
}

interface YosysSynthPrepOutputFiles {
    preSynth: string;
}

interface YosysSynthOutputFiles {
    netlist: string;
}

const DEFAULT_OPTIONS: YosysOptions = {
    optimize: true
};

export const generateYosysWorkerOptions = (
    configuration: ProjectConfiguration,
    projectInputFiles: string[],
    targetId: string
): YosysWorkerOptions => {
    const target = getTarget(configuration, targetId);
    const options = getOptions(configuration, targetId, 'yosys', DEFAULT_OPTIONS);

    const vendor = (VENDORS as Record<string, Vendor>)[target.vendor];
    const family = vendor.families[target.family];

    const inputFiles = projectInputFiles.filter((inputFile) =>
        FILE_EXTENSIONS_HDL.includes(path.extname(inputFile).substring(1))
    );
    const outputFiles = [getTargetFile(target, `${family.architecture}.json`)];

    const tool = 'yosys';
    const commands = [...inputFiles.map((file) => `read_verilog -sv ${file}`), 'proc;'];

    if (options.optimize) {
        commands.push('opt;');
    }

    if (family.architecture === 'generic') {
        commands.push('synth;');
        commands.push(`write_json ${outputFiles[0]};`);
    } else {
        commands.push(`synth_${family.architecture} -json ${outputFiles[0]};`);
    }

    return {
        inputFiles: inputFiles,
        outputFiles: outputFiles,
        tool,
        commands: commands
    };
};

export const getYosysWorkerOptions = (project: Project, targetId: string): YosysWorkerOptions => {
    const generated = generateYosysWorkerOptions(project.getConfiguration(), project.getInputFiles(), targetId);

    const inputFiles = getCombined(project.getConfiguration(), targetId, 'yosys', 'inputFiles', generated.inputFiles);
    const outputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'yosys',
        'outputFiles',
        generated.outputFiles
    );

    const tool = generated.tool;
    const commands = getCombined(project.getConfiguration(), targetId, 'yosys', 'commands', generated.commands);

    return {
        inputFiles,
        outputFiles,
        tool,
        commands
    };
};

export const generateYosysRTLCommands = (inputFiles: string[], outputFiles: YosysRTLOutputFiles): string[] => {
    const verilogFiles = inputFiles.filter((file) => FILE_EXTENSIONS_VERILOG.includes(path.extname(file).substring(1)));

    // Yosys commands taken from yosys2digitaljs (https://github.com/tilk/yosys2digitaljs/blob/1b4afeae61/src/index.js#L1225)

    return [
        ...verilogFiles.map((file) => `read_verilog -sv ${file}`),
        'hierarchy -auto-top;',
        'proc;',
        'opt;',
        'memory -nomap;',
        'wreduce -memx;',
        'opt -full;',
        `tee -q -o ${outputFiles.stats} stat -json -width *;`,
        `write_json ${outputFiles.rtl};`,
        ''
    ];
};

export const generateYosysSynthPrepareCommands = (
    inputFiles: string[],
    outputFiles: YosysSynthPrepOutputFiles
): string[] => {
    const verilogFiles = inputFiles.filter((file) => FILE_EXTENSIONS_VERILOG.includes(path.extname(file).substring(1)));

    return [
        ...verilogFiles.map((file) => `read_verilog -sv ${file}`),
        'proc;',
        'opt;',
        `write_json ${outputFiles.preSynth};`,
        ''
    ];
};

export const generateYosysSynthCommands = (inputFile: string, outputFiles: YosysSynthOutputFiles): string[] => {
    return [`read_json ${inputFile}`, `synth_ecp5 -json ${outputFiles.netlist};`, ''];
};
