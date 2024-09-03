import path from 'path';

import type {
    ProjectConfiguration,
    TargetConfiguration,
    TargetDefaultsConfiguration,
    TargetOptionTypes,
    ValueListConfiguration,
    ValueListConfigurationTarget,
    WorkerId
} from './configuration.js';

export const getTargetDefaults = (configuration: ProjectConfiguration): TargetDefaultsConfiguration => {
    return configuration.defaults ?? {};
};

export const getTarget = (configuration: ProjectConfiguration, targetId: string): TargetConfiguration => {
    const target = configuration.targets.find((target) => target.id === targetId);
    if (!target) {
        throw new Error(`Target "${targetId}" could not be found.`);
    }
    return target;
};

export const getTargetFile = (target: TargetConfiguration, file: string) => path.join(target.directory ?? '.', file);

export const getDefaultOptions = <W extends WorkerId>(
    configuration: ProjectConfiguration,
    workerId: W,
    defaultValues: TargetOptionTypes[W]
): TargetOptionTypes[W] => {
    const targetDefaults = getTargetDefaults(configuration)[workerId];
    const defaultConfig = targetDefaults ? targetDefaults.options : undefined;

    return {
        ...defaultValues,
        ...defaultConfig
    };
};

export const getOptions = <W extends WorkerId>(
    configuration: ProjectConfiguration,
    targetId: string,
    workerId: W,
    defaultValues: TargetOptionTypes[W]
): TargetOptionTypes[W] => {
    const defaultOptions = getDefaultOptions(configuration, workerId, defaultValues);

    const target = getTarget(configuration, targetId)[workerId];
    const config = target ? target.options : undefined;

    return {
        ...defaultOptions,
        ...config
    };
};

const defaultParse = (values: string[]) => values;

export const getCombined = (
    configuration: ProjectConfiguration,
    targetId: string,
    workerId: WorkerId,
    configId: string,
    generated: string[],
    parse: (values: string[]) => string[] = defaultParse
) => {
    const targetDefaults = getTargetDefaults(configuration)[workerId];
    const target = getTarget(configuration, targetId)[workerId];

    const defaultConfig = targetDefaults ? (targetDefaults[configId] as ValueListConfiguration) : undefined;
    const config = target ? (target[configId] as ValueListConfigurationTarget) : undefined;

    return [
        ...(!config || config.useGenerated ? generated : []),
        ...((!config || config.useDefault) && !!defaultConfig ? parse(defaultConfig.values) : []),
        ...(config ? parse(config.values) : [])
    ];
};
