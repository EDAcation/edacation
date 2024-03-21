import {z} from 'zod';

import type {ArrayElement} from '../util.js';

export const DEFAULT_CONFIGURATION: ProjectConfiguration = {
    targets: [
        {
            id: 'default',
            name: 'ECP5 - LFE5U-12 - caBGA381',

            vendor: 'lattice',
            family: 'ecp5',
            device: 'lfe5u-12',
            package: 'caBGA381'
        }
    ]
};

const schemaValueList = z.object({
    useGenerated: z.boolean().optional().default(true),
    values: z.array(z.string()).optional().default([])
});
const schemaValueListTarget = schemaValueList.extend({
    useDefault: z.boolean().optional().default(true)
});

const schemaWorker = z.object({
    inputFiles: schemaValueList.optional(),
    outputFiles: schemaValueList.optional()
});
const schemaWorkerTarget = z.object({
    inputFiles: schemaValueListTarget.optional(),
    outputFiles: schemaValueListTarget.optional()
});

const schemaYosysOptions = z.object({
    optimize: z.boolean().optional()
});

const schemaYosys = z.object({
    commands: schemaValueList.optional(),
    options: schemaYosysOptions.optional()
});
const schemaYosysTarget = z.object({
    commands: schemaValueListTarget.optional(),
    options: schemaYosysOptions.optional()
});

const schemaNextpnrOptions = z.object({
    placedSvg: z.boolean().optional(),
    routedSvg: z.boolean().optional(),
    routedJson: z.boolean().optional()
});

const schemaNextpnr = z.object({
    arguments: schemaValueList.optional(),
    options: schemaNextpnrOptions.optional()
});
const schemaNextpnrTarget = z.object({
    arguments: schemaValueListTarget.optional(),
    options: schemaNextpnrOptions.optional()
});

const schemaCombinedYosys = schemaWorker.merge(schemaYosys);
const schemaCombinedYosysTarget = schemaWorkerTarget.merge(schemaYosysTarget);
const schemaCombinedNextpnr = schemaWorker.merge(schemaNextpnr);
const schemaCombinedNextpnrTarget = schemaWorkerTarget.merge(schemaNextpnrTarget);

const schemaTargetDefaults = z.object({
    yosys: schemaCombinedYosys.optional(),
    nextpnr: schemaCombinedNextpnr.optional()
});

const schemaTarget = z.object({
    id: z.string(),
    name: z.string(),

    vendor: z.string(),
    family: z.string(),
    device: z.string(),
    package: z.string(),

    directory: z.string().optional(),

    yosys: schemaCombinedYosysTarget.optional(),
    nextpnr: schemaCombinedNextpnrTarget.optional()
});

export const schemaProjectConfiguration = z.object({
    defaults: schemaTargetDefaults.optional(),
    targets: z.array(schemaTarget)
});

export type ProjectConfiguration = z.infer<typeof schemaProjectConfiguration>;
export type TargetDefaultsConfiguration = NonNullable<ProjectConfiguration['defaults']>;
export type TargetConfiguration = ArrayElement<ProjectConfiguration['targets']>;
export type ValueListConfiguration = z.infer<typeof schemaValueList>;
export type ValueListConfigurationTarget = z.infer<typeof schemaValueListTarget>;
export type WorkerId = 'yosys' | 'nextpnr';
export type WorkerConfiguration = z.infer<typeof schemaWorker>;
export type WorkerTargetConfiguration = z.infer<typeof schemaWorkerTarget>;
export type YosysOptions = z.infer<typeof schemaYosysOptions>;
export type YosysConfiguration = z.infer<typeof schemaYosys>;
export type YosysTargetConfiguration = z.infer<typeof schemaYosysTarget>;
export type NextpnrOptions = z.infer<typeof schemaNextpnrOptions>;
export type NextpnrConfiguration = z.infer<typeof schemaNextpnr>;
export type NextpnrTargetConfiguration = z.infer<typeof schemaNextpnrTarget>;

export type TargetOptionTypes = {
    yosys: YosysOptions;
    nextpnr: NextpnrOptions;
};
