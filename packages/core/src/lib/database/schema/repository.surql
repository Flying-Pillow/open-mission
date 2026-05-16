DEFINE TABLE OVERWRITE repository TYPE NORMAL SCHEMAFULL COMMENT "Canonical Repository storage records.";
DEFINE FIELD OVERWRITE ownerId ON TABLE repository TYPE string COMMENT "Owner segment derived from the platform repository ref or local Repository identity.";
DEFINE FIELD OVERWRITE platformRepositoryRef ON TABLE repository TYPE option<string> COMMENT "Optional hosted repository ref associated with this local Repository.";
DEFINE FIELD OVERWRITE repoName ON TABLE repository TYPE string COMMENT "Repository name segment derived from the local or hosted Repository identity.";
DEFINE FIELD OVERWRITE repositoryRootPath ON TABLE repository TYPE string COMMENT "Filesystem root path of the checked-out Repository.";
DEFINE INDEX OVERWRITE repository_root_path_idx ON TABLE repository FIELDS repositoryRootPath UNIQUE;
