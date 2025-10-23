import {parseArgs} from 'string-args-parser';

import type {NextpnrOptions, ProjectConfiguration, WorkerOptions, WorkerStep} from './configuration.js';
import {VENDORS} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getOptions, getTarget, getTargetFile} from './target.js';

// Empty for now
export type NextpnrStep = WorkerStep;

export type NextpnrWorkerOptions = WorkerOptions<NextpnrStep, NextpnrOptions>;

const DEFAULT_OPTIONS: NextpnrOptions = {
    placedSvg: false,
    routedSvg: false,
    routedJson: true,
    pinConfigFile: undefined
};

export const parseNextpnrArguments = (args: string[]) => args.flatMap((arg) => parseArgs(arg));

export const getNextpnrOptions = (configuration: ProjectConfiguration, targetId: string): NextpnrOptions =>
    getOptions(configuration, targetId, 'nextpnr', DEFAULT_OPTIONS);

export const getNextpnrWorkerOptions = (
    project: Project,
    targetId: string
): NextpnrWorkerOptions => {
    const configuration = project.getConfiguration();
    const target = getTarget(configuration, targetId);
    const options = getNextpnrOptions(configuration, targetId);

    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];
    const device = family.devices[target.device];

    // Input files
    const generatedInputFiles = [`${family.architecture}.json`].map(f => getTargetFile(target, f));
    const inputFiles = getCombined(
        configuration,
        targetId,
        'nextpnr',
        'inputFiles',
        generatedInputFiles
    ).filter((f) => !!f);

    // Tool
    const tool = `nextpnr-${family.architecture}`;

    // Output files / args
    const generatedOutputFiles: string[] = [];
    const generatedArgs: string[] = [];

    switch (family.architecture) {
        case 'ecp5': {
            generatedArgs.push(`--${device.device}`);
            generatedArgs.push('--package', target.package.toUpperCase());

            if (options.pinConfigFile) {
                generatedArgs.push('--lpf', options.pinConfigFile);
            }

            // Write bitstream file
            const file = getTargetFile(target, `${family.architecture}.config`);
            generatedOutputFiles.push(file);
            generatedArgs.push('--textcfg', file);
            break;
        }
        case 'generic': {
            break;
        }
        case 'gowin': {
            generatedArgs.push('--device', `${device.device.replace('-', '-UV')}${target.package}C5/I4`);
            break;
        }
        case 'ice40': {
            generatedArgs.push(`--${device.device}`);
            generatedArgs.push('--package', target.package);

            if (options.pinConfigFile) {
                generatedArgs.push('--pcf', options.pinConfigFile);
            }

            // Write ASC file
            const file = getTargetFile(target, `${family.architecture}.asc`);
            generatedOutputFiles.push(file);
            generatedArgs.push('--asc', file);
            break;
        }
        case 'nexus': {
            const packageLookup: Record<string, string> = {
                WLCSP72: 'UWG72',
                QFN72: 'SG72',
                csfBGA121: 'MG121',
                caBGA256: 'BG256',
                csfBGA289: 'MG289',
                caBGA400: 'BG400'
            };

            const devPackage = packageLookup[target.package];
            if (!devPackage) {
                throw new Error(`Package "${target.package}" is currenty not supported.`);
            }

            generatedArgs.push('--device', `${device.device}-7${devPackage}C`);
            break;
        }
        default: {
            throw new Error(`Architecture "${family.architecture}" is currently not supported.`);
        }
    }

    generatedArgs.push('--json', inputFiles[0]);

    if (options.placedSvg) {
        const file = getTargetFile(target, 'placed.svg');
        generatedOutputFiles.push(file);
        generatedArgs.push('--placed-svg', file);
    }
    if (options.routedSvg) {
        const file = getTargetFile(target, 'routed.svg');
        generatedOutputFiles.push(file);
        generatedArgs.push('--routed-svg', file);
    }
    if (options.routedJson) {
        const file = getTargetFile(target, 'routed.nextpnr.json');
        generatedOutputFiles.push(file);
        generatedArgs.push('--write', file);
    }

    const outputFiles = getCombined(
        configuration,
        targetId,
        'nextpnr',
        'outputFiles',
        generatedOutputFiles
    ).filter((f) => !!f);

    const args = getCombined(
        configuration,
        targetId,
        'nextpnr',
        'arguments',
        generatedArgs,
        parseNextpnrArguments
    );

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps: [
            {
                id: 'pnr',
                tool,
                arguments: args
            }
        ]
    };
};
