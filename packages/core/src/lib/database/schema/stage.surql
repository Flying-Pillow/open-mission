DEFINE TABLE OVERWRITE stage TYPE NORMAL SCHEMAFULL COMMENT "Mission stage physical storage record. SurrealDB record id is the Stage identity.";
DEFINE FIELD OVERWRITE artifacts ON TABLE stage TYPE array<object> COMMENT "Stage artifact data stored in the physical Stage record.";
DEFINE FIELD OVERWRITE isCurrentStage ON TABLE stage TYPE bool COMMENT "Whether this Stage is the current Mission stage in the physical Stage record.";
DEFINE INDEX OVERWRITE stage_iscurrentstage_idx ON TABLE stage FIELDS isCurrentStage;
DEFINE FIELD OVERWRITE lifecycle ON TABLE stage TYPE string COMMENT "Stage lifecycle state stored in the physical Stage record.";
DEFINE INDEX OVERWRITE stage_lifecycle_idx ON TABLE stage FIELDS lifecycle;
DEFINE FIELD OVERWRITE missionId ON TABLE stage TYPE record<mission> REFERENCE ON DELETE CASCADE COMMENT "Owning Mission reference stored in the physical Stage record.";
