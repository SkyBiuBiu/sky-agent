import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.artifacts import ArtifactsService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/artifacts", tags=["artifacts"])


# ---------- Pydantic Schemas ----------
class ArtifactsData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: int
    version: int = None
    kind: str
    path: str
    content: str


class ArtifactsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[int] = None
    version: Optional[int] = None
    kind: Optional[str] = None
    path: Optional[str] = None
    content: Optional[str] = None


class ArtifactsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    project_id: int
    version: Optional[int] = None
    kind: str
    path: str
    content: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ArtifactsListResponse(BaseModel):
    """List response schema"""
    items: List[ArtifactsResponse]
    total: int
    skip: int
    limit: int


class ArtifactsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[ArtifactsData]


class ArtifactsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: ArtifactsUpdateData


class ArtifactsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[ArtifactsBatchUpdateItem]


class ArtifactsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=ArtifactsListResponse)
async def query_artifactss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query artifactss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying artifactss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = ArtifactsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} artifactss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid artifacts query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying artifactss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=ArtifactsListResponse)
async def query_artifactss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query artifactss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying artifactss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = ArtifactsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} artifactss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid artifacts query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying artifactss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=ArtifactsResponse)
async def get_artifacts(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single artifacts by ID (user can only see their own records)"""
    logger.debug(f"Fetching artifacts with id: {id}, fields={fields}")
    
    service = ArtifactsService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Artifacts with id {id} not found")
            raise HTTPException(status_code=404, detail="Artifacts not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching artifacts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=ArtifactsResponse, status_code=201)
async def create_artifacts(
    data: ArtifactsData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new artifacts"""
    logger.debug(f"Creating new artifacts with data: {data}")
    
    service = ArtifactsService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create artifacts")
        
        logger.info(f"Artifacts created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating artifacts: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating artifacts: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[ArtifactsResponse], status_code=201)
async def create_artifactss_batch(
    request: ArtifactsBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple artifactss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} artifactss")
    
    service = ArtifactsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} artifactss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[ArtifactsResponse])
async def update_artifactss_batch(
    request: ArtifactsBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple artifactss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} artifactss")
    
    service = ArtifactsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} artifactss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=ArtifactsResponse)
async def update_artifacts(
    id: int,
    data: ArtifactsUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing artifacts (requires ownership)"""
    logger.debug(f"Updating artifacts {id} with data: {data}")

    service = ArtifactsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Artifacts with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Artifacts not found")
        
        logger.info(f"Artifacts {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating artifacts {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating artifacts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_artifactss_batch(
    request: ArtifactsBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple artifactss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} artifactss")
    
    service = ArtifactsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} artifactss successfully")
        return {"message": f"Successfully deleted {deleted_count} artifactss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_artifacts(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single artifacts by ID (requires ownership)"""
    logger.debug(f"Deleting artifacts with id: {id}")
    
    service = ArtifactsService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Artifacts with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Artifacts not found")
        
        logger.info(f"Artifacts {id} deleted successfully")
        return {"message": "Artifacts deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting artifacts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")