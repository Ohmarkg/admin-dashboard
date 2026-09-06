import SHPEtinas from "/public/shpetinas_icon.svg";
import TechnicalAffairs from "/public/technical_affairs_icon.svg";
import DefaultIcon from "/public/generic_course_icon.svg";
import Scholastic from "/public/scholastic_committee_icon.svg";
import MentorSHPE from "/public/mentorshpe_committee_icon.svg";
import Presidents from "/public/presidents_committee_icon.svg";
import PublicRelations from "/public/public_relations_committee_icon.svg";
import JonesSHPEjr from "/public/jones_shpe_jr_committee.svg";
import Treasurer from "/public/treasurer_committee_icon.svg";
import InternalAffairs from "/public/internal_affairs_committee_icon.svg";
import Secretary from "/public/secretary_committee_icon.svg";
import ProfessionalDevelopment from "/public/professional_development_committee_icon.svg";
import type { PublicUserInfo } from "./user";

/** Keep this registry in sync with MobileApp/src/types/committees.ts. */
export const committeeLogos = {
    professionalDevelopment: { LogoComponent: ProfessionalDevelopment, width: 100, height: 100 },
    internalAffairs: { LogoComponent: InternalAffairs, width: 100, height: 100 },
    secretary: { LogoComponent: Secretary, width: 100, height: 100 },
    treasurer: { LogoComponent: Treasurer, width: 100, height: 100 },
    jonesSHPEjr: { LogoComponent: JonesSHPEjr, width: 75, height: 65 },
    publicRelations: { LogoComponent: PublicRelations, width: 100, height: 80 },
    scholasticCommittee: { LogoComponent: Scholastic, width: 75, height: 70 },
    presidentsCommittee: { LogoComponent: Presidents, width: 75, height: 70 },
    mentorshpeCommittee: { LogoComponent: MentorSHPE, width: 70, height: 70 },
    shpetinas: { LogoComponent: SHPEtinas, width: 100, height: 100 },
    technicalAffairs: { LogoComponent: TechnicalAffairs, width: 75, height: 80 },
    default: { LogoComponent: DefaultIcon, width: 60, height: 60 },
};

export const getLogoComponent = (logoName: keyof typeof committeeLogos = "default") =>
    committeeLogos[logoName] || committeeLogos.default;

export type CommitteeLogosName = keyof typeof committeeLogos;

/** Canonical Firestore shape shared with the mobile app. */
export interface CommitteeRecord {
    name: string;
    color: string;
    description: string;
    head?: string;
    representatives: string[];
    leads: string[];
    applicationLink: string;
    logo: CommitteeLogosName;
    memberCount: number;
    isOpen: boolean;
}

/** Input accepted by create/update forms. memberCount is server-maintained. */
export type CommitteeInput = Omit<CommitteeRecord, "memberCount">;

/** Hydrated read model used by the admin UI. */
export interface Committee extends Omit<CommitteeRecord, "head" | "representatives" | "leads"> {
    firebaseDocName: string;
    head?: PublicUserInfo;
    representatives: PublicUserInfo[];
    leads: PublicUserInfo[];
}

export const reverseFormattedFirebaseName = (firebaseName: string) =>
    firebaseName
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

export const committeeSlugFromName = (name: string) =>
    name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
