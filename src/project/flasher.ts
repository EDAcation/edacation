import {parseArgs} from 'string-args-parser';

import type {FlasherOptions, ProjectConfiguration, WorkerOptions, WorkerStep} from './configuration.js';
import type {Project} from './project.js';
import {getCombined, getOptions, getTarget, getTargetFile} from './target.js';
import { VENDORS } from './devices.js';

// Empty for now
export type FlasherStep = WorkerStep;

export type FlasherWorkerOptions = WorkerOptions<FlasherStep, FlasherOptions>;

const DEFAULT_OPTIONS: FlasherOptions = {
    board: undefined,
};

export const parseFlasherArguments = (args: string[]) => args.flatMap((arg) => parseArgs(arg));

export const getFlasherOptions = (configuration: ProjectConfiguration, targetId: string): FlasherOptions =>
    getOptions(configuration, targetId, 'flasher', DEFAULT_OPTIONS);

export const getFlasherWorkerOptions = (
    project: Project,
    targetId: string
): FlasherWorkerOptions => {
    const configuration = project.getConfiguration();
    const target = getTarget(configuration, targetId);
    const options = getFlasherOptions(configuration, targetId);

    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];

    const generatedInputFiles: string[] = [];
    const generatedOutputFiles: string[] = [];
    let packerTool: string;
    const generatedPackerArgs: string[] = [];
    const generatedFlasherArgs: string[] = [];

    if (options.board) {
        generatedFlasherArgs.push('-b', options.board);
    }

    switch (family.architecture) {
        case 'ecp5': {
            const bitstreamFile = getTargetFile(target, `${family.architecture}.config`);
            generatedInputFiles.push(bitstreamFile);

            const packedFile = getTargetFile(target, `${family.architecture}.bit`);
            generatedOutputFiles.push(packedFile);

            packerTool = 'ecppack';
            generatedPackerArgs.push(bitstreamFile, packedFile);

            generatedFlasherArgs.push(packedFile);
            break;
        }
        case 'ice40': {
            const bitstreamFile = getTargetFile(target, `${family.architecture}.asc`);
            generatedInputFiles.push(bitstreamFile);

            const packedFile = getTargetFile(target, `${family.architecture}.bin`);
            generatedOutputFiles.push(packedFile);

            packerTool = 'icepack';
            generatedPackerArgs.push(bitstreamFile, packedFile);

            generatedFlasherArgs.push(packedFile);
            break;
        }
        default: {
            throw new Error(`Packing not supported for architecture "${family.architecture}"`);
        }
    }

    const inputFiles = getCombined(
        configuration,
        targetId,
        'flasher',
        'inputFiles',
        generatedInputFiles
    ).filter((f) => !!f);
    const outputFiles = getCombined(
        configuration,
        targetId,
        'flasher',
        'outputFiles',
        generatedOutputFiles
    ).filter((f) => !!f);
    const packerArgs = getCombined(
        configuration,
        targetId,
        'flasher',
        'packerArguments',
        generatedPackerArgs,
        parseFlasherArguments
    )
    const flasherArgs = getCombined(
        configuration,
        targetId,
        'flasher',
        'flasherArguments',
        generatedFlasherArgs,
        parseFlasherArguments
    )

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps: [
            {
                id: 'pack',
                tool: packerTool,
                arguments: packerArgs
            },
            {
                id: 'flash',
                tool: 'openFPGALoader',
                arguments: flasherArgs
            }
        ]
    };
};
