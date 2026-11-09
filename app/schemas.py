"""Request bodies. Limits here keep one request from becoming an expensive one."""
from typing import Annotated, Literal

from pydantic import BaseModel, Field

ID_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"
Short = Annotated[str, Field(max_length=800)]


class Block(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    html: str = Field(default="", max_length=60000)


class Rule(BaseModel):
    id: str = Field(max_length=16)
    cat: str = Field(default="", max_length=40)
    text: str = Field(max_length=600)
    strength: Literal["hard", "soft"] = "soft"


class TemplateSection(BaseModel):
    section: str = Field(max_length=80)
    required: bool = False


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=2000)


class AssistRequest(BaseModel):
    request: str = Field(min_length=1, max_length=6000)
    blocks: list[Block] = Field(max_length=3000)
    scope_ids: list[str] = Field(default_factory=list, max_length=3000)
    rules: list[Rule] = Field(default_factory=list, max_length=60)
    template: list[TemplateSection] = Field(default_factory=list, max_length=30)
    voice: str = Field(default="", max_length=600)
    exemplars: list[Short] = Field(default_factory=list, max_length=5)
    source: str = Field(default="", max_length=20000)
    history: list[Turn] = Field(default_factory=list, max_length=8)


class Head(BaseModel):
    lvl: int = Field(ge=1, le=6)
    text: str = Field(max_length=200)


class DocDigest(BaseModel):
    name: str = Field(max_length=200)
    words: int = Field(default=0, ge=0)
    tables: int = Field(default=0, ge=0)
    ol: int = Field(default=0, ge=0)
    ul: int = Field(default=0, ge=0)
    callouts: int = Field(default=0, ge=0)
    avg_sent: int = Field(default=0, ge=0)
    heads: list[Head] = Field(default_factory=list, max_length=60)
    steps: list[Short] = Field(default_factory=list, max_length=8)
    excerpt: str = Field(default="", max_length=800)


class LearnRequest(BaseModel):
    docs: list[DocDigest] = Field(min_length=1, max_length=20)


class ExportRequest(BaseModel):
    title: str = Field(default="Document", max_length=200)
    html: str = Field(max_length=3_000_000)
