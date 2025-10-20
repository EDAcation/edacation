import {parseArgs} from 'string-args-parser';

import type {FlasherOptions, ProjectConfiguration, WorkerOptions, WorkerStep} from './configuration.js';
import type {Project} from './project.js';
import {getCombined, getDefaultOptions, getOptions, getTarget, getTargetFile} from './target.js';
import { VENDORS } from './devices.js';

// Empty for now
export type FlasherStep = WorkerStep;

export type FlasherWorkerOptions = WorkerOptions<FlasherStep, FlasherOptions>;

const DEFAULT_OPTIONS: FlasherOptions = {
    board: undefined,
};

export const getFlasherDefaultOptions = (configuration: ProjectConfiguration): FlasherOptions =>
    getDefaultOptions(configuration, 'flasher', DEFAULT_OPTIONS);

export const getFlasherOptions = (configuration: ProjectConfiguration, targetId: string): FlasherOptions =>
    getOptions(configuration, targetId, 'flasher', DEFAULT_OPTIONS);

export const generateFlasherWorkerOptions = (
    configuration: ProjectConfiguration,
    targetId: string
): FlasherWorkerOptions => {
    const target = getTarget(configuration, targetId);
    const options = getFlasherOptions(configuration, targetId);

    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];

    const inputFiles: string[] = [];
    const outputFiles: string[] = [];
    const steps: FlasherStep[] = [];
    const flasherArgs: string[] = [];

    if (options.board) {
        flasherArgs.push('-b', options.board);
    }

    switch (family.architecture) {
        case 'ecp5': {
            const bitstreamFile = getTargetFile(target, `${family.architecture}.config`);
            inputFiles.push(bitstreamFile);

            const packedFile = getTargetFile(target, `${family.architecture}.bit`);
            outputFiles.push(packedFile);

            steps.push({tool: 'ecppack', arguments: [bitstreamFile, packedFile]});

            flasherArgs.push(packedFile);
            break;
        }
        case 'ice40': {
            const bitstreamFile = getTargetFile(target, `${family.architecture}.asc`);
            inputFiles.push(bitstreamFile);

            const packedFile = getTargetFile(target, `${family.architecture}.bin`);
            outputFiles.push(packedFile);

            steps.push({tool: 'icepack', arguments: [bitstreamFile, packedFile]});

            flasherArgs.push(packedFile);
            break;
        }
        default: {
            throw new Error(`Packing not supported for architecture "${family.architecture}"`);
        }
    }

    steps.push({tool: 'openFPGALoader', arguments: flasherArgs});

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps
    };
};

export const parseFlasherArguments = (args: string[]) => args.flatMap((arg) => parseArgs(arg));

export const getFlasherWorkerOptions = (project: Project, targetId: string): FlasherWorkerOptions => {
    const generated = generateFlasherWorkerOptions(project.getConfiguration(), targetId);

    const inputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'flasher',
        'inputFiles',
        generated.inputFiles
    ).filter((f) => !!f);
    const outputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'flasher',
        'outputFiles',
        generated.outputFiles
    ).filter((f) => !!f);

    const target = generated.target;
    const options = generated.options;
    const steps = generated.steps.map((step) => {
        const tool = step.tool;
        const args = getCombined(project.getConfiguration(), targetId, 'flasher', 'arguments', step.arguments, parseFlasherArguments);
        return {tool, arguments: args};
    });

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps
    };
};
