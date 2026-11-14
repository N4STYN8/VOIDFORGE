export type CrewPurchaseIntent={kind:'install';module:import('./data.ts').ModuleKind;x:number;y:number}|{kind:'upgrade';module:import('./data.ts').EquipmentKind;level:number;x:number;y:number}|{kind:'ship';hangar:number}|{kind:'repair';hull:number;integrity:number};
export type CrewEconomyMark={id:string;phase:'debited'|'applied'|'refunded'};
