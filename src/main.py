from typing import Annotated, Dict, List, Optional
from sqlmodel import Field, Session, SQLModel, create_engine, select
from fastapi import FastAPI, Request, Depends, Query, HTTPException, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import pandas as pd
import networkx as nx
import json
import io
import uuid
from datetime import datetime

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"
connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

class Graph(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = Field(default=None)
    data: str = Field(default=None)
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    node_count: int = Field(default=0)
    edge_count: int = Field(default=0)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session

SessionDep = Annotated[Session, Depends(get_session)]

@app.on_event("startup")
def on_startup():
    create_db_and_tables()

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request, name="index.html", context={}
    )

@app.get("/upload", response_class=HTMLResponse)
async def upload_page(request: Request):
    return templates.TemplateResponse(
        request=request, name="upload.html", context={}
    )

@app.get("/view/{graph_id}", response_class=HTMLResponse)
async def view_graph(request: Request, graph_id: int, session: SessionDep):
    graph = session.get(Graph, graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    return templates.TemplateResponse(
        request=request, name="view.html", context={"graph_id": graph_id, "graph_name": graph.name}
    )

@app.get("/graphs", response_class=HTMLResponse)
async def list_graphs_page(request: Request):
    return templates.TemplateResponse(
        request=request, name="graphs.html", context={}
    )

@app.get("/api/graphs")
async def get_graphs(session: SessionDep):
    graphs = session.exec(select(Graph)).all()
    return graphs

@app.get("/api/graph/{graph_id}")
async def get_graph(graph_id: int, session: SessionDep):
    graph = session.get(Graph, graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    return graph

@app.post("/api/graph/new")
async def create_graph(
    session: SessionDep,
    name: str = Form(...),
    description: Optional[str] = Form(None),
    data: Optional[str] = Form(None)
) -> Graph:
    graph_data = json.loads(data) if data else {"graph": {"nodes": {}, "edges": []}}

    # Calculate node and edge counts
    node_count = len(graph_data.get("graph", {}).get("nodes", {}))
    edge_count = len(graph_data.get("graph", {}).get("edges", []))

    graph = Graph(
        name=name,
        description=description,
        data=json.dumps(graph_data),
        node_count=node_count,
        edge_count=edge_count
    )

    session.add(graph)
    session.commit()
    session.refresh(graph)
    return graph

@app.post("/api/upload/csv")
async def upload_csv(
    session: SessionDep,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    node_id_col: str = Form(...),
    node_label_col: Optional[str] = Form(None),
    source_col: str = Form(...),
    target_col: str = Form(...),
    relation_col: Optional[str] = Form(None)
):
    try:
        # Read CSV
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))

        # Create NetworkX graph
        G = nx.DiGraph()

        # Add nodes
        for _, row in df[[node_id_col] + ([node_label_col] if node_label_col else [])].drop_duplicates().iterrows():
            node_id = str(row[node_id_col])
            node_label = str(row[node_label_col]) if node_label_col else node_id

            # Add metadata from other columns
            metadata = {}
            for col in df.columns:
                if col not in [node_id_col, source_col, target_col, relation_col]:
                    if col != node_label_col:
                        node_row = df[df[node_id_col] == row[node_id_col]].iloc[0]
                        if pd.notna(node_row.get(col)):
                            metadata[col] = node_row[col]

            G.add_node(node_id, label=node_label, metadata=metadata)

        # Add edges
        for _, row in df.iterrows():
            source = str(row[source_col])
            target = str(row[target_col])

            # Skip if source or target doesn't exist
            if source not in G.nodes or target not in G.nodes:
                continue

            relation = str(row[relation_col]) if relation_col and pd.notna(row.get(relation_col)) else "relates_to"
            G.add_edge(source, target, relation=relation)

        # Convert NetworkX graph to JGF format
        jgf_data = {
            "graph": {
                "directed": True,
                "label": name,
                "nodes": {},
                "edges": []
            }
        }

        # Add nodes to JGF
        for node_id, node_attr in G.nodes(data=True):
            jgf_data["graph"]["nodes"][node_id] = {
                "label": node_attr.get("label", node_id),
                "metadata": node_attr.get("metadata", {})
            }

        # Add edges to JGF
        for source, target, edge_attr in G.edges(data=True):
            jgf_data["graph"]["edges"].append({
                "source": source,
                "target": target,
                "relation": edge_attr.get("relation", "relates_to")
            })

        # Store in database
        graph = Graph(
            name=name,
            description=description,
            data=json.dumps(jgf_data),
            node_count=len(jgf_data["graph"]["nodes"]),
            edge_count=len(jgf_data["graph"]["edges"])
        )

        session.add(graph)
        session.commit()
        session.refresh(graph)

        return {"id": graph.id, "message": "Graph created successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing CSV: {str(e)}")

@app.post("/api/upload/json")
async def upload_json(
    session: SessionDep,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(None)
):
    try:
        content = await file.read()
        json_data = json.loads(content)

        # Validate basic structure
        if "graph" not in json_data:
            raise HTTPException(status_code=400, detail="Invalid JGF format: missing 'graph' object")

        if "nodes" not in json_data["graph"] or "edges" not in json_data["graph"]:
            raise HTTPException(status_code=400, detail="Invalid JGF format: missing 'nodes' or 'edges'")

        # Calculate statistics
        node_count = len(json_data["graph"]["nodes"])
        edge_count = len(json_data["graph"]["edges"])

        # Store in database
        graph = Graph(
            name=name,
            description=description,
            data=json.dumps(json_data),
            node_count=node_count,
            edge_count=edge_count
        )

        session.add(graph)
        session.commit()
        session.refresh(graph)

        return {"id": graph.id, "message": "Graph uploaded successfully"}

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing JSON: {str(e)}")

@app.delete("/api/graph/{graph_id}")
async def delete_graph(graph_id: int, session: SessionDep):
    graph = session.get(Graph, graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    session.delete(graph)
    session.commit()
    return {"message": "Graph deleted successfully"}

@app.get("/api/graph/{graph_id}/stats")
async def get_graph_stats(graph_id: int, session: SessionDep):
    graph = session.get(Graph, graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    graph_data = json.loads(graph.data)

    # Use NetworkX for advanced statistics
    G = nx.DiGraph()

    # Add nodes
    for node_id, node_data in graph_data["graph"]["nodes"].items():
        G.add_node(node_id, **node_data)

    # Add edges
    for edge in graph_data["graph"]["edges"]:
        G.add_edge(edge["source"], edge["target"], relation=edge.get("relation", "relates_to"))

    # Calculate statistics
    stats = {
        "node_count": G.number_of_nodes(),
        "edge_count": G.number_of_edges(),
        "density": nx.density(G),
        "is_connected": nx.is_weakly_connected(G),
        "avg_in_degree": sum(dict(G.in_degree()).values()) / max(1, len(G)),
        "avg_out_degree": sum(dict(G.out_degree()).values()) / max(1, len(G)),
    }

    try:
        stats["diameter"] = nx.diameter(G.to_undirected()) if nx.is_connected(G.to_undirected()) else "Not connected"
    except:
        stats["diameter"] = "N/A"

    try:
        stats["avg_clustering"] = nx.average_clustering(G)
    except:
        stats["avg_clustering"] = "N/A"

    return stats
