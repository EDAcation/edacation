import path from 'path';

import {FILE_EXTENSIONS_HDL, FILE_EXTENSIONS_VERILOG} from '../util.js';

import type {ProjectConfiguration, WorkerOptions, YosysOptions} from './configuration.js';
import {VENDORS} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getOptions, getTarget, getTargetFile} from './target.js';

export interface YosysWorkerOptions extends WorkerOptions {
    commands: string[];
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

    const vendor = VENDORS[target.vendor];
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
        inputFiles,
        outputFiles,
        tool,
        target,
        commands
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
    const target = generated.target;
    const commands = getCombined(project.getConfiguration(), targetId, 'yosys', 'commands', generated.commands);

    return {
        inputFiles,
        outputFiles,
        tool,
        target,
        commands
    };
};

export const generateYosysRTLCommands = (workerOptions: YosysWorkerOptions): string[] => {
    const verilogFiles = workerOptions.inputFiles.filter((file) =>
        FILE_EXTENSIONS_VERILOG.includes(path.extname(file).substring(1))
    );

    // Yosys commands taken from yosys2digitaljs (https://github.com/tilk/yosys2digitaljs/blob/1b4afeae61/src/index.js#L1225)

    return [
        ...verilogFiles.map((file) => `read_verilog -sv ${file}`),
        'hierarchy -auto-top;',
        'proc;',
        'opt;',
        'memory -nomap;',
        'wreduce -memx;',
        'opt -full;',
        `tee -q -o ${getTargetFile(workerOptions.target, 'stats.yosys.json')} stat -json -width *;`,
        `write_json ${getTargetFile(workerOptions.target, 'rtl.yosys.json')};`,
        ''
    ];
};

export const generateYosysSynthPrepareCommands = (workerOptions: YosysWorkerOptions): string[] => {
    const verilogFiles = workerOptions.inputFiles.filter((file) =>
        FILE_EXTENSIONS_VERILOG.includes(path.extname(file).substring(1))
    );

    return [
        ...verilogFiles.map((file) => `read_verilog -sv ${file}`),
        'proc;',
        'opt;',
        `write_json ${getTargetFile(workerOptions.target, 'presynth.yosys.json')};`,
        ''
    ];
};

export const generateYosysSynthCommands = (workerOptions: YosysWorkerOptions): string[] => {
    return [
        `read_json ${getTargetFile(workerOptions.target, 'presynth.yosys.json')}`,
        `synth_ecp5 -json ${workerOptions.outputFiles[0]};`,
        ''
    ];
};
