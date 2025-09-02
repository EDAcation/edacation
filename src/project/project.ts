import {decodeJSON, encodeJSON} from '../util.js';

import {DEFAULT_CONFIGURATION, DEFAULT_TARGET, type ProjectConfiguration, schemaProjectConfiguration, TargetConfiguration, TargetOptionTypes, WorkerId} from './configuration.js';
import {Device, Family, Vendor, VENDORS} from './devices.js';
import { getIVerilogOptions } from './iverilog.js';
import { getNextpnrOptions } from './nextpnr.js';
import { defaultParse, getCombined } from './target.js';
import { getYosysOptions } from './yosys.js';

// Utility types for strongly typed array-based paths into TargetConfiguration
// A path is represented as a tuple of property names, e.g. ['yosys','options','topLevelModule'].
// Primitive or array properties are treated as terminals.
// Refined type for primitives (includes callable signatures via function type)
type Primitive = string | number | boolean | bigint | symbol | null | undefined | Date | RegExp | ((...args: unknown[]) => unknown);
type PathArray<T> = T extends Primitive ? never : {
    [K in Extract<keyof T, string>]:
        T[K] extends Primitive | unknown[] ? [K] : [K] | [K, ...PathArray<T[K]>]
}[Extract<keyof T, string>];
type PathArrayValue<T, P extends readonly string[]> =
    P extends [] ? T :
    P extends [infer K extends string, ...infer R extends string[]]
        ? K extends keyof T
            ? PathArrayValue<T[K], R>
            : unknown
        : unknown;

export type ProjectEvent = 'meta' | 'inputFiles' | 'outputFiles' | 'configuration';

type EventCallback = (project: Project, events: ProjectEvent[]) => void;

export interface ProjectInputFileState {
    path: string;
    type: 'design' | 'testbench';
}

export class ProjectInputFile {
    constructor(
        private _project: Project,
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
        if (this._type === type) return;
        this._type = type;
        this._project.triggerInputFilesChanged();
    }

    serialize(): ProjectInputFileState {
        return {
            path: this.path,
            type: this.type
        };
    }

    static deserialize(project: Project, data: ProjectInputFileState | string, ..._args: unknown[]): ProjectInputFile {
        // Older versions (<= 0.3.9) stored input files as an array of paths
        if (typeof data === 'string') {
            data = {path: data, type: 'design'};
        }
        return new ProjectInputFile(project, data.path, data.type);
    }

    copy(project: Project): ProjectInputFile {
        return ProjectInputFile.deserialize(project, this.serialize());
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
        if (this._targetId === id) return;
        this._targetId = id;
        this._project.triggerOutputFilesChanged();
    }

    get target(): ProjectTarget | null {
        if (!this._targetId) return null;
        return this._project.getTarget(this._targetId);
    }

    get stale(): ProjectOutputFileState['stale'] {
        return this._stale;
    }

    set stale(isStale: ProjectOutputFileState['stale']) {
        if (this._stale === isStale) return;
        this._stale = isStale;
        this._project.triggerOutputFilesChanged();
    }

    serialize(): ProjectOutputFileState {
        return {
            path: this.path,
            targetId: this.targetId,
            stale: this.stale
        };
    }

    static deserialize(project: Project, data: ProjectOutputFileState | string, ..._args: unknown[]) {
        // Older versions (<= 0.3.12) stored output files as an array of paths
        if (typeof data === 'string') {
            data = {path: data, targetId: null, stale: false};
        }
        return new ProjectOutputFile(project, data.path, data.targetId, data.stale);
    }

    copy(project: Project): ProjectOutputFile {
        return ProjectOutputFile.deserialize(project, this.serialize());
    }
}

export class ProjectTarget {
    constructor(
        private _project: Project,
        private _data: TargetConfiguration
    ) {}

    get id(): string {
        return this._data.id;
    }

    set id(newId: string) {
        if (newId === this._data.id) return;
        if (this._project.hasTarget(newId)) {
            throw new Error(`Target with ID "${newId}" already exists!`);
        }
        this._data.id = newId;

        this._project.triggerConfigurationChanged();
    }

    get name(): string {
        return this._data.name;
    }

    set name(newName: string) {
        if (newName === this._data.name) return;
        this._data.name = newName;
        this._project.triggerConfigurationChanged();
    }

    get vendorId(): string {
        return this._data.vendor;
    }

    get availableVendors(): Record<string, Vendor> {
        return VENDORS;
    }

    get vendor(): Vendor | undefined {
        return this.availableVendors[this.vendorId];
    }

    setVendor(vendorId: string) {
        if (vendorId === this._data.vendor) return;
        if (!VENDORS[vendorId]) {
            throw new Error(`Invalid vendor: ${vendorId}`);
        }
        this._data.vendor = vendorId;

        // Reset family/device/package when changing vendor
        this._data.family = Object.keys(this.availableFamilies)[0];
        this._data.device = Object.keys(this.availableDevices)[0];
        this._data.package = Object.keys(this.availablePackages)[0];

        this._project.triggerConfigurationChanged();
    }

    get familyId(): string {
        return this._data.family;
    }

    get availableFamilies(): Record<string, Family> {
        return this.vendor?.families || {};
    }

    get family(): Family | undefined {
        return this.availableFamilies[this.familyId];
    }

    setFamily(familyId: string) {
        if (familyId === this._data.family) return;
        if (!this.vendor?.families[familyId]) {
            throw new Error(`Invalid family: ${familyId}`);
        }
        this._data.family = familyId;

        // Reset device/package when changing family
        this._data.device = Object.keys(this.availableDevices)[0];
        this._data.package = Object.keys(this.availablePackages)[0];

        this._project.triggerConfigurationChanged();
    }

    get deviceId(): string {
        return this._data.device;
    }

    get availableDevices(): Record<string, Device> {
        return this.family?.devices || {};
    }

    get device(): Device | undefined {
        return this.availableDevices[this.deviceId];
    }

    setDevice(deviceId: string) {
        if (deviceId === this._data.device) return;
        if (!this.family?.devices[deviceId]) {
            throw new Error(`Invalid device: ${deviceId}`);
        }
        this._data.device = deviceId;

        // Reset package when changing device
        this._data.package = Object.keys(this.availablePackages)[0];

        this._project.triggerConfigurationChanged();
    }

    get packageId(): string {
        return this._data.package;
    }

    get availablePackages(): Record<string, string> {
        return this.device?.packages.reduce(
            (prev, packageId) => {
                const vendorPackages: Record<string, string> = VENDORS[this.vendorId].packages;
                prev[packageId] = vendorPackages[packageId] ?? packageId;
                return prev;
            },
            {} as Record<string, string>
        ) ?? {};
    }

    get package(): string | undefined {
        return this.availablePackages[this.packageId];
    }

    setPackage(packageId: string) {
        if (packageId === this._data.package) return;
        if (!this.device?.packages.includes(packageId)) {
            throw new Error(`Invalid package: ${packageId}`);
        }
        this._data.package = packageId;

        this._project.triggerConfigurationChanged();
    }

    get config(): TargetConfiguration {
        return this._data;
    }

    setConfig<P extends PathArray<TargetConfiguration>>(path: P, value: PathArrayValue<TargetConfiguration, P>) {
        if (!path.length) throw new Error('Path must be a non-empty array');

        let cursor: Record<string, unknown> = this._data as unknown as Record<string, unknown>;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            const next = cursor[key];
            if (typeof next !== 'object' || next === null) {
                const child: Record<string, unknown> = {};
                cursor[key] = child;
                cursor = child;
            } else {
                cursor = next as Record<string, unknown>;
            }
        }

        const last = path[path.length - 1];
        if (cursor[last] === value) return;
        cursor[last] = value as unknown;
        
        this._project.triggerConfigurationChanged();
    }

    getEffectiveOptions<W extends WorkerId>(workerId: WorkerId): TargetOptionTypes[W] {
        if (workerId === 'yosys') return getYosysOptions(this._project.getConfiguration(), this.id);
        else if (workerId === 'nextpnr') return getNextpnrOptions(this._project.getConfiguration(), this.id);
        else if (workerId === 'iverilog') return getIVerilogOptions(this._project.getConfiguration(), this.id);
        throw new Error(`Worker ID "${String(workerId)}" is not supported.`);
    }

    getEffectiveTextConfig(
        workerId: WorkerId,
        configId: string,
        generated: string[],
        parse: (values: string[]) => string[] = defaultParse,
    ) {
        return getCombined(
            this._project.getConfiguration(),
            this.id,
            workerId,
            configId,
            generated,
            parse
        );
    }

    update(updates: Partial<TargetConfiguration>) {
        if (updates.id && updates.id !== this.id) {
            if (this._project.hasTarget(updates.id)) {
                throw new Error(`Target with ID "${updates.id}" already exists!`);
            }
            this._data.id = updates.id;
        }
        Object.assign(this._data, structuredClone(updates));
        
        this._project.triggerConfigurationChanged();
    }

    serialize(): TargetConfiguration {
        return this._data;
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
        this.inputFiles = inputFiles.map((file: ProjectInputFileState | string) =>
            ProjectInputFile.deserialize(this, file)
        );
        this.outputFiles = outputFiles.map((file: ProjectOutputFileState | string) =>
            ProjectOutputFile.deserialize(this, file)
        );

        const config = schemaProjectConfiguration.safeParse(configuration);
        if (config.success) {
            this.configuration = config.data;
        } else {
            throw new Error(`Failed to parse project configuration: ${config.error.toString()}`);
        }

        // Trigger any updates that the configuration might want to do
        this.updateConfiguration({});

        // Set event callback LAST to prevent firing events in constructor
        this.eventCallback = eventCallback;
    }

    getName() {
        return this.name;
    }

    @Project.emitsEvents('meta')
    setName(name: string) {
        this.name = name;
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
                const inputFile = new ProjectInputFile(this, file.path, file.type ?? 'design');
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

        const cfg = target.config;
        if (!cfg.yosys) cfg.yosys = {};
        if (!cfg.yosys.options) cfg.yosys.options = {};

        cfg.yosys.options.topLevelModule = module;
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

        const cfg = target.config;
        if (!cfg.iverilog) cfg.iverilog = {};
        if (!cfg.iverilog.options) cfg.iverilog.options = {};

        cfg.iverilog.options.testbenchFile = testbenchPath;
    }

    @Project.emitsEvents('inputFiles')
    setInputFileType(filePath: string, type: ProjectInputFile['type']) {
        const file = this.getInputFile(filePath);
        if (!file) {
            console.warn(`Tried to set file type of missing input file: ${filePath}`);
            return;
        }
        file.type = type; // internal setter triggers event; batched by decorator
    }

    getTargets(): ProjectTarget[] {
        return this.configuration.targets.map(t => new ProjectTarget(this, t));
    }

    hasTarget(id: string): boolean {
        return this.configuration.targets.some(t => t.id === id);
    }

    getTarget(id: string): ProjectTarget | null {
        const t = this.configuration.targets.find(t => t.id === id);
        return t ? new ProjectTarget(this, t) : null;
    }

    @Project.emitsEvents('configuration')
    addTarget(id?: string, config?: Omit<TargetConfiguration, 'id'>): ProjectTarget {
        if (!id) {
            // Generate a unique ID
            let idx = 1;
            while (this.hasTarget(`target${idx}`)) idx += 1;
            id = `target${idx}`;
        } else if (this.hasTarget(id)) {
            throw new Error(`Target with ID "${id}" already exists!`);
        }

        const newTargetObj: TargetConfiguration = {
            ...structuredClone(config || DEFAULT_TARGET),
            id
        };
        
        this.configuration.targets.push(newTargetObj);
        return new ProjectTarget(this, newTargetObj);
    }

    @Project.emitsEvents('configuration')
    removeTarget(id: string) {
        // In-place removal to avoid reassigning the targets array reference
        const targetsArr = this.configuration.targets;
        for (let i = targetsArr.length - 1; i >= 0; i--) {
            if (targetsArr[i].id === id) targetsArr.splice(i, 1);
        }
        for (const outFile of this.outputFiles) {
            if (outFile.targetId === id) outFile.targetId = null;
        }
    }

    updateTarget(id: string, updates: Partial<TargetConfiguration>) {
        const target = this.getTarget(id);
        if (!target) throw new Error(`Target with ID "${id}" does not exist!`);
        target.update(updates);
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
        // Remove invalid target references from output files
        for (const outFile of this.outputFiles) {
            if (!outFile.target) outFile.targetId = null;
        }
    }

    @Project.emitsEvents()
    protected importFromProject(other: Project, doTriggerEvent = true) {
        this.inputFiles = other.getInputFiles().map((file) => file.copy(this));
        this.outputFiles = other.getOutputFiles().map((file) => file.copy(this));
        this.configuration = structuredClone(other.getConfiguration());

        if (doTriggerEvent) this.emitEvents('inputFiles', 'outputFiles', 'configuration');
    }

    // Public triggers used by file/target objects
    public triggerInputFilesChanged() {
        this.emitEvents('inputFiles');
    }

    public triggerOutputFilesChanged() {
        this.emitEvents('outputFiles');
    }

    public triggerConfigurationChanged() {
        this.emitEvents('configuration');
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
