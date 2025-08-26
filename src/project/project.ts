import {decodeJSON, encodeJSON} from '../util.js';

import {DEFAULT_CONFIGURATION, DEFAULT_TARGET, type ProjectConfiguration, schemaProjectConfiguration, TargetConfiguration} from './configuration.js';

export type ProjectEvent = 'inputFiles' | 'outputFiles' | 'configuration';

type EventCallback = (project: Project, events: ProjectEvent[]) => void;

export interface ProjectInputFileState {
    path: string;
    type: 'design' | 'testbench';
}

export class ProjectInputFile {
    constructor(
        private _path: ProjectInputFileState['path'],
        private _type: ProjectInputFileState['type']
    ) {}

    get path(): ProjectInputFileState['path'] {
        return this._path;
    }

    get type(): ProjectInputFileState['type'] {
        return this._type;
    }

    set type(type: ProjectInputFileState['type']) {
        this._type = type;
    }

    serialize(): ProjectInputFileState {
        return {
            path: this.path,
            type: this.type
        };
    }

    static deserialize(data: ProjectInputFileState | string, ..._args: unknown[]): ProjectInputFile {
        // Older versions of this module (<= 0.3.9) stored input files as an array of paths instead,
        // so we need to migrate if data is a string (single output file).
        if (typeof data === 'string') {
            data = {path: data, type: 'design'};
        }

        return new ProjectInputFile(data.path, data.type);
    }

    copy(): ProjectInputFile {
        return ProjectInputFile.deserialize(this.serialize());
    }
}

export interface ProjectOutputFileState {
    path: string;
    targetId: string | null;
    stale: boolean;
}

export class ProjectOutputFile {
    constructor(
        private _project: Project,
        private _path: ProjectOutputFileState['path'],
        private _targetId: ProjectOutputFileState['targetId'] = null,
        private _stale: ProjectOutputFileState['stale'] = false
    ) {}

    get path(): ProjectOutputFileState['path'] {
        return this._path;
    }

    get targetId(): ProjectOutputFileState['targetId'] {
        return this._targetId;
    }

    set targetId(id: ProjectOutputFileState['targetId']) {
        if (id !== null && this._project.getTarget(id) === null) {
            throw new Error(`Invalid target id: ${id}`);
        }
        this._targetId = id;
    }

    get target(): TargetConfiguration | null {
        if (!this._targetId) return null;
        return this._project.getTarget(this._targetId);
    }

    get stale(): ProjectOutputFileState['stale'] {
        return this._stale;
    }

    set stale(isStale: ProjectOutputFileState['stale']) {
        this._stale = isStale;
    }

    serialize(): ProjectOutputFileState {
        return {
            path: this.path,
            targetId: this.targetId,
            stale: this.stale
        };
    }

    static deserialize(project: Project, data: ProjectOutputFileState | string, ..._args: unknown[]) {
        // Older versions of this module (<= 0.3.12) stored output files as an array of paths instead,
        // so we need to migrate if data is a string (single output file).
        if (typeof data === 'string') {
            data = {path: data, targetId: null, stale: false};
        }

        return new ProjectOutputFile(project, data.path, data.targetId, data.stale);
    }

    copy(project: Project): ProjectOutputFile {
        return ProjectOutputFile.deserialize(project, this.serialize());
    }
}

export interface ProjectState {
    name: string;
    inputFiles: ProjectInputFileState[] | string[];
    outputFiles: ProjectOutputFileState[] | string[];
    configuration: ProjectConfiguration;
}

export class Project {
    private name: string;
    private inputFiles: ProjectInputFile[];
    private outputFiles: ProjectOutputFile[];
    private configuration: ProjectConfiguration;
    private eventCallback?: EventCallback;

    private batchedEvents: Set<ProjectEvent> = new Set();
    private batchCounter: number = 0;

    constructor(
        name: string,
        inputFiles: ProjectInputFileState[] | string[] = [],
        outputFiles: ProjectOutputFileState[] | string[] = [],
        configuration: ProjectConfiguration = DEFAULT_CONFIGURATION,
        eventCallback?: EventCallback
    ) {
        this.name = name;
        this.inputFiles = inputFiles.map((file: ProjectInputFileState | string) => ProjectInputFile.deserialize(file));
        this.outputFiles = outputFiles.map((file: ProjectOutputFileState | string) =>
            ProjectOutputFile.deserialize(this, file)
        );

        const config = schemaProjectConfiguration.safeParse(configuration);
        if (config.success) {
            this.configuration = config.data;
        } else {
            throw new Error(`Failed to parse project configuration: ${config.error.toString()}`);
        }

        // Trigger a config 'update' to deploy any modifications it might want to make
        this.updateConfiguration({});

        // Set event callback LAST to prevent firing events in constructor
        this.eventCallback = eventCallback;
    }

    getName() {
        return this.name;
    }

    getInputFiles() {
        return this.inputFiles;
    }

    hasInputFile(filePath: string) {
        return this.getInputFile(filePath) !== null;
    }

    getInputFile(filePath: string): ProjectInputFile | null {
        return this.inputFiles.find((file) => file.path === filePath) ?? null;
    }

    @Project.emitsEvents('inputFiles')
    addInputFiles(files: {path: string; type?: ProjectInputFileState['type']}[]) {
        for (const file of files) {
            if (!this.hasInputFile(file.path)) {
                const inputFile = new ProjectInputFile(file.path, file.type ?? 'design');
                this.inputFiles.push(inputFile);
            }
        }

        this.inputFiles.sort((a, b) => {
            return a < b ? -1 : 1;
        });

        this.expireOutputFiles();
    }

    @Project.emitsEvents('inputFiles')
    removeInputFiles(filePaths: string[]) {
        this.inputFiles = this.inputFiles.filter((file) => !filePaths.includes(file.path));

        this.expireOutputFiles();
    }

    getOutputFiles() {
        return this.outputFiles;
    }

    hasOutputFile(filePath: string): boolean {
        return this.getOutputFile(filePath) !== null;
    }

    getOutputFile(filePath: string): ProjectOutputFile | null {
        return this.outputFiles.find((file) => file.path === filePath) ?? null;
    }

    @Project.emitsEvents('outputFiles')
    addOutputFiles(files: {path: string; targetId: string}[]) {
        for (const file of files) {
            const existingOutFile = this.getOutputFile(file.path);
            if (existingOutFile) {
                // File already exists, so we don't want to add it again.
                // But, we should make sure the target ID gets updated and set `stale` to false.
                existingOutFile.targetId = file.targetId;
                existingOutFile.stale = false;
                continue;
            }

            const outputFile = new ProjectOutputFile(this, file.path, file.targetId);
            if (outputFile.target === null) throw new Error(`Invalid target ID: ${file.targetId}`);
            this.outputFiles.push(outputFile);
        }

        this.outputFiles.sort((a, b) => {
            return a < b ? -1 : 1;
        });
    }

    @Project.emitsEvents('outputFiles')
    removeOutputFiles(filePaths: string[]) {
        this.outputFiles = this.outputFiles.filter((file) => !filePaths.includes(file.path));
    }

    @Project.emitsEvents()
    expireOutputFiles() {
        if (!this.outputFiles.length) return;

        let didUpdate = false;
        for (const file of this.outputFiles) {
            if (!file.stale) {
                file.stale = true;
                didUpdate = true;
            }
        }

        if (didUpdate) this.emitEvents('outputFiles');
    }

    @Project.emitsEvents('configuration')
    setTopLevelModule(targetId: string, module: string) {
        const target = this.getTarget(targetId);
        if (!target) throw new Error(`Target "${targetId}" does not exist!`);

        // Ensure the config tree exists
        // We don't care about setting missing defaults, as this is target-level configuration,
        // so any missing properties will fallback to project-level config.
        if (!target.yosys) target.yosys = {};
        if (!target.yosys.options) target.yosys.options = {};

        target.yosys.options.topLevelModule = module;
    }

    @Project.emitsEvents('configuration')
    setTestbenchPath(targetId: string, testbenchPath?: string) {
        const testbenchFiles = this.getInputFiles()
            .filter((file) => file.type === 'testbench')
            .map((file) => file.path);
        if (testbenchPath && !testbenchFiles.includes(testbenchPath))
            throw new Error(`Testbench ${testbenchPath} is not marked as such!`);

        const target = this.getTarget(targetId);
        if (!target) throw new Error(`Target "${targetId}" does not exist!`);

        // Ensure the config tree exists
        // We don't care about setting missing defaults, as this is target-level configuration,
        // so any missing properties will fallback to project-level config.
        if (!target.iverilog) target.iverilog = {};
        if (!target.iverilog.options) target.iverilog.options = {};

        target.iverilog.options.testbenchFile = testbenchPath;
    }

    @Project.emitsEvents('inputFiles')
    setInputFileType(filePath: string, type: ProjectInputFile['type']) {
        const file = this.getInputFile(filePath);
        if (!file) {
            console.warn(`Tried to set file type of missing input file: ${filePath}`);
            return;
        }

        file.type = type;
    }

    getTargets(): TargetConfiguration[] {
        return this.configuration.targets;
    }

    hasTarget(id: string): boolean {
        return this.getTarget(id) !== null;
    }

    getTarget(id: string): TargetConfiguration | null {
        const targets = this.configuration.targets;
        return targets.find((target) => target.id === id) ?? null;
    }

    @Project.emitsEvents('configuration')
    addTarget(id?: string): TargetConfiguration {
        if (!id) {
            // Generate a unique ID
            let idx = 1;
            while (this.hasTarget(`target${idx}`)) {
                idx += 1;
            }
            id = `target${idx}`;
        } else if (this.hasTarget(id)) {
            throw new Error(`Target with ID "${id}" already exists!`);
        }

        const newTarget = DEFAULT_TARGET;
        newTarget.id = id;

        this.configuration.targets.push(newTarget);

        return newTarget;
    }

    removeTarget(id: string) {
        this.configuration.targets = this.configuration.targets.filter((target) => target.id !== id);

        // Unset target ID from any output files using this target
        for (const outFile of this.outputFiles) {
            if (outFile.targetId === id) outFile.targetId = null;
        }
    }

    updateTarget(id: string, updates: Partial<Omit<TargetConfiguration, 'id'>>) {
        const target = this.getTarget(id);
        if (!target) throw new Error(`Target with ID "${id}" does not exist!`);
        Object.assign(target, updates);
    }

    getConfiguration() {
        return this.configuration;
    }

    @Project.emitsEvents('configuration')
    updateConfiguration(configuration: Partial<ProjectConfiguration>) {
        this.configuration = {
            ...this.configuration,
            ...configuration
        };

        // Unset 'lingering' output file target IDs
        for (const outFile of this.outputFiles) {
            if (!outFile.target) outFile.targetId = null;
        }
    }

    @Project.emitsEvents()
    protected importFromProject(other: Project, doTriggerEvent = true) {
        this.inputFiles = other.getInputFiles().map((file) => file.copy());
        this.outputFiles = other.getOutputFiles().map((file) => file.copy(this));
        this.configuration = structuredClone(other.getConfiguration());

        if (doTriggerEvent) this.emitEvents('inputFiles', 'outputFiles', 'configuration');
    }

    protected emitEvents(...events: ProjectEvent[]) {
        for (const event of events) this.batchedEvents.add(event);

        // Do not emit when empty
        if (!this.batchedEvents.size) return;

        // Do not emit events when batching
        if (this.batchCounter > 0) return;

        // Emit new + batched events
        if (this.eventCallback) this.eventCallback(this, Array.from(this.batchedEvents));
        this.batchedEvents.clear();
    }

    protected batchEvents<T>(func: () => T, ...events: ProjectEvent[]): T {
        this.batchCounter += 1;
        const res = func();
        this.batchCounter -= 1;

        this.emitEvents(...events);

        return res;
    }

    protected static emitsEvents(...events: ProjectEvent[]) {
        return function decorator<T>(
            _target: object,
            _propertyKey: string | symbol,
            descriptor: TypedPropertyDescriptor<T>
        ): TypedPropertyDescriptor<T> | void {
            const originalMethod = descriptor.value;
            if (typeof originalMethod !== 'function') throw new Error('No original method!');

            descriptor.value = function(this: Project, ...args: unknown[]) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return this.batchEvents(() => originalMethod.apply(this, args), ...events);
            } as T;

            return descriptor;
        };
    }

    static serialize(project: Project): ProjectState {
        return {
            name: project.name,
            inputFiles: project.inputFiles.map((file) => file.serialize()),
            outputFiles: project.outputFiles.map((file) => file.serialize()),
            configuration: project.configuration
        };
    }

    static deserialize(data: ProjectState, ..._args: unknown[]): Project {
        const name: string = data.name;
        const inputFiles: ProjectInputFileState[] | string[] = data.inputFiles ?? [];
        const outputFiles: ProjectOutputFileState[] | string[] = data.outputFiles ?? [];
        const configuration: ProjectConfiguration = data.configuration ?? {};

        return new Project(name, inputFiles, outputFiles, configuration);
    }

    static loadFromData(rawData: Uint8Array): Project {
        const data = decodeJSON(rawData);
        const project = Project.deserialize(data as ProjectState);
        return project;
    }

    static storeToData(project: Project): Uint8Array {
        const data = Project.serialize(project);
        return encodeJSON(data, true);
    }
}
